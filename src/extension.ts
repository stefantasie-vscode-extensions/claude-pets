// Claude Pets – extension host: patch Claude Code's webview, run the bridge, manage hooks.
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Bridge } from './bridge';
import { CLAUDE_EXTENSION_ID, resolveClaudeFiles, type ClaudeFiles } from './claudeLocator';
import { applyCspPatch, cspStateOfFile, removeCspPatch, type CspState } from './csp';
import {
  defaultSettingsPath,
  hookCommand,
  hookStatusOfFile,
  installHooks,
  uninstallHooks,
} from './hooksInstaller';
import { applyInjection, buildCssBlock, buildJsBlock, currentBlock, injectionStatus, removeInjection } from './injector';
import { cleanupOrphans, loadOrCreateToken, petsHome, removeInstance, writeInstance } from './instances';
import { hookEventNames } from './shared/triggers';
import { SPECIES_IDS, SPECIES_LABELS, bridgePorts, type PetConfig, type PetEvent, type ReduceMotion } from './shared/types';

const TOKEN_KEY = 'claudePets.token';
const HOOKS_OFFERED_KEY = 'claudePets.hooksInstalledOnce';
const MARKETPLACE_ID = 'anthropic.claude-code';

let controller: Controller | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  controller = new Controller(context);
  await controller.start();
}

export async function deactivate(): Promise<void> {
  await controller?.stop();
  controller = null;
}

type ApplyOutcome = 'written-new' | 'written-update' | 'unchanged' | 'removed' | 'missing' | 'error';

class Controller {
  private readonly out: vscode.OutputChannel;
  private readonly status: vscode.StatusBarItem;
  private bridge: Bridge | null = null;
  private token = '';
  private version: string;
  private cspState: CspState | 'deaktiviert' | 'unbekannt' = 'unbekannt';
  private lastPatch: { at: Date; outcome: ApplyOutcome; detail?: string } | null = null;
  private lastClaude: { path: string; version: string } | null = null;
  private reportedSpecies: string | null = null;
  private applyTimer: NodeJS.Timeout | null = null;
  private missingNotified = false;
  private applying: Promise<ApplyOutcome> | null = null;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.out = vscode.window.createOutputChannel('Claude Pets');
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.status.command = 'claudePets.chooseSpecies';
    this.version = String((ctx.extension.packageJSON as { version?: string }).version ?? '0.0.0');
    ctx.subscriptions.push(this.out, this.status);
  }

  // ----- settings ------------------------------------------------------------------

  private get conf(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('claudePets');
  }

  private setting<T>(key: string, fallback: T): T {
    const v = this.conf.get<T>(key);
    return v === undefined || v === null ? fallback : v;
  }

  private get enabled(): boolean {
    return this.setting('enabled', true);
  }

  private get hooksEnabled(): boolean {
    return this.setting('hooks.enabled', true);
  }

  private get debug(): boolean {
    return this.setting('debug', false);
  }

  log(msg: string): void {
    this.out.appendLine(`[${new Date().toLocaleTimeString('de-DE')}] ${msg}`);
  }

  private debugLog(msg: string): void {
    if (!this.debug) return;
    this.log(msg);
    try {
      fs.mkdirSync(petsHome(), { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(petsHome(), 'debug.log'), `${new Date().toISOString()} ${msg}\n`, { mode: 0o600 });
    } catch {
      /* ignore */
    }
  }

  private buildConfig(bridgeEnabled: boolean): PetConfig {
    const scale = Number(this.setting('scale', 2));
    return {
      version: this.version,
      species: this.setting<string>('species', 'hund'),
      scale: Number.isFinite(scale) ? Math.min(4, Math.max(1, scale)) : 2,
      showButtons: this.setting('showButtons', true),
      wander: this.setting('idle.wander', true),
      sleepAfterMs: Math.max(1, Number(this.setting('idle.sleepAfterMinutes', 4))) * 60000,
      opacityOnHover: Math.min(1, Math.max(0, Number(this.setting('opacityOnHover', 0.35)))),
      reduceMotion: this.setting<ReduceMotion>('reduceMotion', 'auto'),
      debug: this.debug,
      bridge: { enabled: bridgeEnabled, ports: bridgePorts(), token: this.token },
    };
  }

  // ----- lifecycle -----------------------------------------------------------------

  async start(): Promise<void> {
    // ~/.claude-pets/token is the cross-window source of truth (globalState is not atomic
    // between windows that activate at the same time); globalState mirrors it.
    this.token = loadOrCreateToken(this.ctx.globalState.get<string>(TOKEN_KEY));
    if (this.ctx.globalState.get<string>(TOKEN_KEY) !== this.token) await this.ctx.globalState.update(TOKEN_KEY, this.token);

    this.registerCommands();
    this.updateStatusBar();

    try {
      const removed = cleanupOrphans();
      if (removed > 0) this.log(`${removed} verwaiste Instanz-Einträge entfernt.`);
    } catch (err) {
      this.log(`Aufräumen der Instanzen fehlgeschlagen: ${errText(err)}`);
    }
    await this.startBridge();

    this.ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('claudePets')) return;
        if (e.affectsConfiguration('claudePets.enabled') || e.affectsConfiguration('claudePets.hooks.enabled')) {
          void this.syncHooks(false);
        }
        this.updateStatusBar();
        this.scheduleApply('Einstellungen geändert');
      }),
      vscode.extensions.onDidChange(() => {
        const ext = this.findClaude();
        const key = ext ? `${ext.extensionPath}` : '';
        if (key !== (this.lastClaude?.path ?? '')) this.scheduleApply('Claude Code wurde aktualisiert');
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.registerInstance()),
    );

    await this.syncHooks(true);
    await this.apply('Start');
  }

  async stop(): Promise<void> {
    if (this.applyTimer) clearTimeout(this.applyTimer);
    await this.bridge?.stop();
    removeInstance(process.pid);
  }

  private workspaceFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  private async startBridge(): Promise<void> {
    this.bridge = new Bridge({
      token: this.token,
      version: this.version,
      workspaceFolders: () => this.workspaceFolders(),
      log: (m) => this.log(m),
      onEvent: (ev: PetEvent) => this.debugLog(`Ereignis: ${JSON.stringify(ev)}`),
      onSpecies: (species, persist) => void this.onSpeciesFromWebview(species, persist),
    });
    const port = await this.bridge.start();
    if (port === null) {
      this.log('Kein freier Port zwischen 47811 und 47830 – Hook-Ereignisse sind in diesem Fenster nicht verfügbar.');
      return;
    }
    this.log(`Bridge läuft auf 127.0.0.1:${port}.`);
    this.registerInstance();
  }

  private registerInstance(): void {
    if (!this.bridge?.port) return;
    try {
      writeInstance({
        pid: process.pid,
        port: this.bridge.port,
        token: this.token,
        workspaceFolders: this.workspaceFolders(),
        startedAt: new Date().toISOString(),
        version: this.version,
      });
    } catch (err) {
      this.log(`Instanz konnte nicht registriert werden: ${errText(err)}`);
    }
  }

  private async onSpeciesFromWebview(species: string, persist: boolean): Promise<void> {
    if (!(SPECIES_IDS as readonly string[]).includes(species)) return;
    this.reportedSpecies = species;
    this.updateStatusBar();
    if (persist && this.setting<string>('species', 'hund') !== species) {
      await this.conf.update('species', species, vscode.ConfigurationTarget.Global);
    }
  }

  // ----- Claude Code ---------------------------------------------------------------

  private findClaude(): vscode.Extension<unknown> | undefined {
    return vscode.extensions.all.find((e) => e.id.toLowerCase() === CLAUDE_EXTENSION_ID);
  }

  private locate(): ClaudeFiles | null {
    const ext = this.findClaude();
    if (!ext) return null;
    return resolveClaudeFiles(ext.extensionPath);
  }

  private scheduleApply(reason: string): void {
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.applyTimer = setTimeout(() => void this.apply(reason), 300);
  }

  private apply(reason: string): Promise<ApplyOutcome> {
    // Serialise: a running apply finishes before the next one starts.
    const run = async (): Promise<ApplyOutcome> => this.applyNow(reason);
    this.applying = (this.applying ?? Promise.resolve('unchanged' as ApplyOutcome)).then(run, run);
    return this.applying;
  }

  private async applyNow(reason: string): Promise<ApplyOutcome> {
    const files = this.locate();
    if (!this.enabled) {
      const removed = files ? this.removePatches(files) : false;
      this.lastPatch = { at: new Date(), outcome: removed ? 'removed' : 'unchanged', detail: reason };
      if (removed) void this.offerReload('Claude Pets wurde aus Claude Code entfernt. Fenster neu laden, damit das Haustier verschwindet.');
      return this.lastPatch.outcome;
    }
    if (!files) {
      this.lastPatch = { at: new Date(), outcome: 'missing', detail: reason };
      this.cspState = 'unbekannt';
      if (!this.missingNotified) {
        this.missingNotified = true;
        const ext = this.findClaude();
        const msg = ext
          ? 'Claude Pets: Die Webview-Dateien von Claude Code wurden nicht gefunden. Details unter „Claude Pets: Diagnose“.'
          : 'Claude Pets braucht die Claude-Code-Extension.';
        const action = ext ? undefined : 'Claude Code installieren';
        const pick = await (action ? vscode.window.showWarningMessage(msg, action) : vscode.window.showWarningMessage(msg));
        if (pick === 'Claude Code installieren') {
          await vscode.commands.executeCommand('workbench.extensions.search', MARKETPLACE_ID);
        }
      }
      return 'missing';
    }
    this.lastClaude = { path: files.extensionPath, version: files.version };

    try {
      // 1. CSP of Claude's webview (connect-src for the bridge).
      if (files.extensionJs) {
        if (this.setting('patchCsp', true)) {
          const r = applyCspPatch(files.extensionJs);
          if (r === 'written') this.log(`CSP in ${files.extensionJs} um connect-src http://127.0.0.1:* erweitert.`);
          this.cspState = cspStateOfFile(files.extensionJs);
        } else {
          removeCspPatch(files.extensionJs);
          this.cspState = cspStateOfFile(files.extensionJs);
          if (this.cspState === 'patched') this.cspState = 'deaktiviert';
        }
      } else {
        this.cspState = 'not-found';
      }
      const bridgeEnabled = this.cspState === 'allowed' || this.cspState === 'patched';

      // 2. Webview script and stylesheet.
      const dist = path.join(this.ctx.extensionPath, 'dist');
      const webviewJs = fs.readFileSync(path.join(dist, 'webview.js'), 'utf8');
      const webviewCss = fs.readFileSync(path.join(dist, 'webview.css'), 'utf8');
      const config = this.buildConfig(bridgeEnabled);
      const jsBlock = buildJsBlock(this.version, webviewJs, config);
      const cssBlock = buildCssBlock(this.version, webviewCss);
      const before = currentBlock(fs.readFileSync(files.webviewJs, 'utf8'));
      const res = applyInjection({ jsPath: files.webviewJs, cssPath: files.webviewCss }, jsBlock, cssBlock);
      const written = res.js === 'written' || res.css === 'written';
      const outcome: ApplyOutcome = !written ? 'unchanged' : before ? 'written-update' : 'written-new';
      this.lastPatch = { at: new Date(), outcome, detail: reason };
      if (written) this.log(`Claude Code ${files.version} gepatcht (${reason}).`);

      // Live update for webviews that are already connected.
      this.bridge?.pushConfig(config);

      if (outcome === 'written-new') {
        void this.offerReload('Claude Pets ist bereit. Fenster neu laden, damit das Haustier erscheint.');
      } else if (outcome === 'written-update' && (this.bridge?.clientCount ?? 0) === 0) {
        void this.offerReload('Claude Pets wurde aktualisiert. Fenster neu laden, um die Änderungen anzuwenden.');
      } else if (outcome === 'written-update') {
        vscode.window.setStatusBarMessage('Claude Pets: Einstellungen übernommen', 3000);
      }
      return outcome;
    } catch (err) {
      this.lastPatch = { at: new Date(), outcome: 'error', detail: errText(err) };
      this.log(`Patchen fehlgeschlagen (${reason}): ${errText(err)}`);
      void vscode.window.showErrorMessage('Claude Pets konnte Claude Code nicht patchen. Es wurde nichts verändert. Details im Ausgabekanal „Claude Pets“.');
      return 'error';
    }
  }

  private removePatches(files: ClaudeFiles): boolean {
    let changed = false;
    try {
      const r = removeInjection({ jsPath: files.webviewJs, cssPath: files.webviewCss });
      changed = r.js === 'written' || r.css === 'written';
      if (files.extensionJs && removeCspPatch(files.extensionJs) === 'written') changed = true;
      if (changed) this.log(`Injektion aus Claude Code ${files.version} entfernt.`);
      this.cspState = files.extensionJs ? cspStateOfFile(files.extensionJs) : 'not-found';
    } catch (err) {
      this.log(`Entfernen fehlgeschlagen: ${errText(err)}`);
      void vscode.window.showErrorMessage('Claude Pets konnte die Injektion nicht entfernen. Details im Ausgabekanal „Claude Pets“.');
    }
    return changed;
  }

  private async offerReload(message: string): Promise<void> {
    const pick = await vscode.window.showInformationMessage(message, 'Neu laden');
    if (pick === 'Neu laden') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  // ----- hooks ---------------------------------------------------------------------

  private async nodeBinary(): Promise<string> {
    const found = await new Promise<boolean>((resolve) => {
      execFile(process.platform === 'win32' ? 'where' : 'which', ['node'], { timeout: 3000 }, (err, stdout) =>
        resolve(!err && stdout.trim().length > 0),
      );
    });
    if (found) return 'node';
    for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
      if (fs.existsSync(p)) {
        this.log(`„node“ ist nicht im PATH, verwende ${p} für die Hooks.`);
        return p;
      }
    }
    this.log('Warnung: „node“ wurde nicht gefunden. Hooks werden eingetragen, laufen aber erst, wenn Node.js im PATH ist.');
    return 'node';
  }

  private async hookCmd(): Promise<string> {
    return hookCommand(this.ctx.extensionPath, await this.nodeBinary());
  }

  /** Install/update or remove the hooks according to the settings. */
  private async syncHooks(startup: boolean): Promise<void> {
    const file = defaultSettingsPath();
    try {
      if (!this.enabled || !this.hooksEnabled) {
        if (uninstallHooks(file) === 'written') this.log(`Hooks aus ${file} entfernt.`);
        return;
      }
      const cmd = await this.hookCmd();
      const before = hookStatusOfFile(file, hookEventNames(), cmd);
      if (before.upToDate) return;
      const result = installHooks(file, hookEventNames(), cmd);
      if (result === 'written') this.log(`Hooks in ${file} eingerichtet (${hookEventNames().length} Ereignisse).`);
      const firstTime = !this.ctx.globalState.get<boolean>(HOOKS_OFFERED_KEY);
      if (result === 'written' && (firstTime || !startup) && !before.installed) {
        await this.ctx.globalState.update(HOOKS_OFFERED_KEY, true);
        void vscode.window.showInformationMessage('Claude-Pets-Hooks wurden eingerichtet.', 'Rückgängig').then(async (pick) => {
          if (pick === 'Rückgängig') await this.conf.update('hooks.enabled', false, vscode.ConfigurationTarget.Global);
        });
      }
    } catch (err) {
      this.log(`Hooks konnten nicht eingerichtet werden: ${errText(err)}`);
      void vscode.window.showWarningMessage(`Claude Pets: ${errText(err)}`);
    }
  }

  // ----- commands & status bar ------------------------------------------------------

  private registerCommands(): void {
    const reg = (id: string, fn: () => unknown) => this.ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
    const global = vscode.ConfigurationTarget.Global;
    reg('claudePets.enable', async () => {
      if (this.enabled) await this.apply('Aktivieren');
      else await this.conf.update('enabled', true, global);
    });
    reg('claudePets.disable', async () => {
      if (!this.enabled) await this.apply('Deaktivieren');
      else await this.conf.update('enabled', false, global);
    });
    reg('claudePets.reapply', async () => {
      const outcome = await this.apply('Neu anwenden');
      if (outcome === 'unchanged') {
        void this.offerReload('Claude Pets ist bereits angewendet. Fenster neu laden, falls das Haustier fehlt.');
      }
    });
    reg('claudePets.chooseSpecies', () => this.chooseSpecies());
    reg('claudePets.installHooks', async () => {
      if (!this.hooksEnabled) await this.conf.update('hooks.enabled', true, global);
      else await this.syncHooks(false);
      void vscode.window.showInformationMessage('Claude-Pets-Hooks sind eingerichtet.');
    });
    reg('claudePets.removeHooks', async () => {
      if (this.hooksEnabled) await this.conf.update('hooks.enabled', false, global);
      else await this.syncHooks(false);
      void vscode.window.showInformationMessage('Claude-Pets-Hooks wurden entfernt.');
    });
    reg('claudePets.diagnose', () => this.diagnose());
  }

  private async chooseSpecies(): Promise<void> {
    const current = this.setting<string>('species', 'hund');
    const items: (vscode.QuickPickItem & { id: string })[] = [...SPECIES_IDS, 'zufall'].map((id) => ({
      id,
      label: SPECIES_LABELS[id] ?? id,
      description: id === current ? 'aktuell' : id === 'zufall' ? 'bei jedem Start ein anderes Tier' : undefined,
    }));
    const pick = await vscode.window.showQuickPick(items, { title: 'Claude Pets: Tier wählen', placeHolder: 'Welches Tier soll auf der Promptbox sitzen?' });
    if (pick && pick.id !== current) await this.conf.update('species', pick.id, vscode.ConfigurationTarget.Global);
  }

  private updateStatusBar(): void {
    if (!this.enabled) {
      this.status.hide();
      return;
    }
    const setting = this.setting<string>('species', 'hund');
    const shown = setting === 'zufall' && this.reportedSpecies ? this.reportedSpecies : setting;
    this.status.text = `🐾 ${SPECIES_LABELS[shown] ?? shown}`;
    this.status.tooltip = 'Claude Pets – Tier wählen';
    this.status.show();
  }

  private diagnose(): void {
    const o = this.out;
    o.show(true);
    o.appendLine('');
    o.appendLine(`===== Claude Pets ${this.version} – Diagnose (${new Date().toLocaleString('de-DE')}) =====`);
    o.appendLine(`Aktiviert: ${this.enabled ? 'ja' : 'nein'} · Tier: ${this.setting<string>('species', 'hund')}${this.reportedSpecies ? ` (angezeigt: ${this.reportedSpecies})` : ''}`);
    const ext = this.findClaude();
    if (!ext) {
      o.appendLine('Claude Code: nicht installiert');
    } else {
      const files = resolveClaudeFiles(ext.extensionPath);
      o.appendLine(`Claude Code: ${String((ext.packageJSON as { version?: string }).version)} in ${ext.extensionPath}`);
      if (files) {
        o.appendLine(`  Ermittlung der Webview-Dateien: ${files.method}`);
        const st = injectionStatus({ jsPath: files.webviewJs, cssPath: files.webviewCss });
        o.appendLine(`  ${files.webviewJs}: ${st.js.present ? `gepatcht (v${st.js.version})` : 'nicht gepatcht'}`);
        o.appendLine(`  ${files.webviewCss}: ${st.css.present ? `gepatcht (v${st.css.version})` : 'nicht gepatcht'}`);
        o.appendLine(`  ${files.extensionJs ?? 'extension.js'}: CSP ${files.extensionJs ? cspStateOfFile(files.extensionJs) : 'nicht gefunden'}`);
      } else {
        o.appendLine('  Webview-Dateien: nicht gefunden');
      }
    }
    const cspText: Record<string, string> = {
      allowed: 'Claude erlaubt die Verbindung bereits',
      patched: 'Variante A – connect-src um http://127.0.0.1:* erweitert',
      blocked: 'Variante B – blockiert, reiner DOM-Modus',
      'not-found': 'keine CSP gefunden',
      deaktiviert: 'Variante B – Erweiterung per Einstellung abgeschaltet, reiner DOM-Modus',
      unbekannt: 'unbekannt',
    };
    o.appendLine(`CSP: ${cspText[this.cspState] ?? this.cspState}`);
    if (this.lastPatch) {
      o.appendLine(`Letzter Patch-Lauf: ${this.lastPatch.at.toLocaleTimeString('de-DE')} → ${this.lastPatch.outcome}${this.lastPatch.detail ? ` (${this.lastPatch.detail})` : ''}`);
    }
    const file = defaultSettingsPath();
    const hs = hookStatusOfFile(file, hookEventNames(), hookCommand(this.ctx.extensionPath));
    o.appendLine(`Hooks (${file}): ${hs.error ? `Fehler: ${hs.error}` : hs.installed ? `${hs.events.length}/${hookEventNames().length} Ereignisse eingetragen` : 'nicht eingetragen'}`);
    for (const c of hs.commands) o.appendLine(`  Befehl: ${c}`);
    o.appendLine(`  Einstellung hooks.enabled: ${this.hooksEnabled ? 'an' : 'aus'}`);
    o.appendLine(`Bridge: ${this.bridge?.port ? `127.0.0.1:${this.bridge.port}` : 'nicht gestartet'} · verbundene Webview-Clients: ${this.bridge?.clientCount ?? 0}`);
    o.appendLine(`Empfangene Ereignisse: ${this.bridge?.eventCount ?? 0}${this.bridge?.lastEventAt ? ` (zuletzt ${new Date(this.bridge.lastEventAt).toLocaleTimeString('de-DE')})` : ''}`);
    o.appendLine(`Instanz-Registrierung: ${path.join(petsHome(), 'instances', `${process.pid}.json`)}`);
    o.appendLine('==========================================================');
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
