// Claude Pets – extension host: patch Claude Code's webview, run the bridge, manage hooks.
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Bridge } from './bridge';
import { CLAUDE_EXTENSION_ID, resolveClaudeFiles, type ClaudeFiles } from './claudeLocator';
import { buildPetConfig, normalizeSpecies } from './config';
import { applyCspPatch, cspStateOfFile, removeCspPatch, type CspState } from './csp';
import {
  defaultSettingsPath,
  hookCommand,
  hookStatusOfFile,
  installHooks,
  uninstallHooks,
} from './hooksInstaller';
import { applyInjection, blockPayload, buildCssBlock, buildJsBlock, currentBlock, injectionStatus, removeInjection } from './injector';
import { cleanupOrphans, loadOrCreateToken, petsHome, removeInstance, writeInstance } from './instances';
import { hookEventNames } from './shared/triggers';
import { RANDOM_SPECIES, SPECIES_IDS, SPECIES_LABELS, type PetConfig, type PetEvent } from './shared/types';

const TOKEN_KEY = 'claudePets.token';
const HOOKS_OFFERED_KEY = 'claudePets.hooksInstalledOnce';
const MARKETPLACE_ID = 'anthropic.claude-code';
const RELOAD = 'Reload Window';

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
  private cspState: CspState | 'disabled' | 'unknown' = 'unknown';
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

  private get species(): string {
    return normalizeSpecies(this.setting<string>('species', 'dog'));
  }

  log(msg: string): void {
    this.out.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
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
    return buildPetConfig((key, fallback) => this.setting(key, fallback), {
      version: this.version,
      token: this.token,
      bridgeEnabled,
    });
  }

  /** Settings written by versions before 0.2.0 used German species ids. */
  private async migrateSettings(): Promise<void> {
    const stored = this.conf.inspect<string>('species')?.globalValue;
    if (stored !== undefined && normalizeSpecies(stored) !== stored) {
      await this.conf.update('species', normalizeSpecies(stored), vscode.ConfigurationTarget.Global);
      this.log(`Migrated setting claudePets.species from "${stored}" to "${normalizeSpecies(stored)}".`);
    }
  }

  // ----- lifecycle -----------------------------------------------------------------

  async start(): Promise<void> {
    // ~/.claude-pets/token is the cross-window source of truth (globalState is not atomic
    // between windows that activate at the same time); globalState mirrors it.
    this.token = loadOrCreateToken(this.ctx.globalState.get<string>(TOKEN_KEY));
    if (this.ctx.globalState.get<string>(TOKEN_KEY) !== this.token) await this.ctx.globalState.update(TOKEN_KEY, this.token);

    await this.migrateSettings();
    this.registerCommands();
    this.updateStatusBar();

    try {
      const removed = cleanupOrphans();
      if (removed > 0) this.log(`Removed ${removed} orphaned instance entries.`);
    } catch (err) {
      this.log(`Cleaning up instances failed: ${errText(err)}`);
    }
    await this.startBridge();

    this.ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('claudePets')) return;
        if (e.affectsConfiguration('claudePets.enabled') || e.affectsConfiguration('claudePets.hooks.enabled')) {
          void this.syncHooks(false);
        }
        this.updateStatusBar();
        this.scheduleApply('settings changed');
      }),
      vscode.extensions.onDidChange(() => {
        const ext = this.findClaude();
        const key = ext ? `${ext.extensionPath}` : '';
        if (key !== (this.lastClaude?.path ?? '')) this.scheduleApply('Claude Code was updated');
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.registerInstance()),
    );

    await this.syncHooks(true);
    await this.apply('startup');
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
      onEvent: (ev: PetEvent) => this.debugLog(`Event: ${JSON.stringify(ev)}`),
      onSpecies: (species, persist) => void this.onSpeciesFromWebview(species, persist),
    });
    const port = await this.bridge.start();
    if (port === null) {
      this.log('No free port between 47811 and 47830 – hook events are not available in this window.');
      return;
    }
    this.log(`Bridge listening on 127.0.0.1:${port}.`);
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
      this.log(`Could not register this window: ${errText(err)}`);
    }
  }

  private async onSpeciesFromWebview(species: string, persist: boolean): Promise<void> {
    if (!(SPECIES_IDS as readonly string[]).includes(species)) return;
    this.reportedSpecies = species;
    this.updateStatusBar();
    if (persist && this.species !== species) {
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
      if (removed) void this.offerReload('Claude Pets was removed from Claude Code. Reload the window to make the pet disappear.');
      return this.lastPatch.outcome;
    }
    if (!files) {
      this.lastPatch = { at: new Date(), outcome: 'missing', detail: reason };
      this.cspState = 'unknown';
      if (!this.missingNotified) {
        this.missingNotified = true;
        const ext = this.findClaude();
        const msg = ext
          ? 'Claude Pets: Could not find the webview files of Claude Code. See "Claude Pets: Show Diagnostics" for details.'
          : 'Claude Pets needs the Claude Code extension.';
        const action = ext ? undefined : 'Install Claude Code';
        const pick = await (action ? vscode.window.showWarningMessage(msg, action) : vscode.window.showWarningMessage(msg));
        if (pick === 'Install Claude Code') {
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
          if (r === 'written') this.log(`Extended the CSP in ${files.extensionJs} with connect-src http://127.0.0.1:*.`);
          this.cspState = cspStateOfFile(files.extensionJs);
        } else {
          removeCspPatch(files.extensionJs);
          this.cspState = cspStateOfFile(files.extensionJs);
          if (this.cspState === 'patched') this.cspState = 'disabled';
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
      // New code, assets or styles need a webview reload; settings alone arrive live.
      const codeChanged = !before || blockPayload(before) !== blockPayload(jsBlock) || res.css === 'written';
      this.lastPatch = { at: new Date(), outcome, detail: reason };
      if (written) this.log(`Patched Claude Code ${files.version} (${reason}).`);

      // Live update for webviews that are already connected.
      this.bridge?.pushConfig(config);

      if (outcome === 'written-new') {
        void this.offerReload('Claude Pets is ready. Reload the window to let your pet appear.');
      } else if (outcome === 'written-update' && (codeChanged || (this.bridge?.clientCount ?? 0) === 0)) {
        void this.offerReload('Claude Pets was updated. Reload the window to apply the changes.');
      } else if (outcome === 'written-update') {
        vscode.window.setStatusBarMessage('Claude Pets: settings applied', 3000);
      }
      return outcome;
    } catch (err) {
      this.lastPatch = { at: new Date(), outcome: 'error', detail: errText(err) };
      this.log(`Patching failed (${reason}): ${errText(err)}`);
      void vscode.window.showErrorMessage('Claude Pets could not patch Claude Code. Nothing was changed. See the "Claude Pets" output channel for details.');
      return 'error';
    }
  }

  private removePatches(files: ClaudeFiles): boolean {
    let changed = false;
    try {
      const r = removeInjection({ jsPath: files.webviewJs, cssPath: files.webviewCss });
      changed = r.js === 'written' || r.css === 'written';
      if (files.extensionJs && removeCspPatch(files.extensionJs) === 'written') changed = true;
      if (changed) this.log(`Removed the injection from Claude Code ${files.version}.`);
      this.cspState = files.extensionJs ? cspStateOfFile(files.extensionJs) : 'not-found';
    } catch (err) {
      this.log(`Removing failed: ${errText(err)}`);
      void vscode.window.showErrorMessage('Claude Pets could not remove the injection. See the "Claude Pets" output channel for details.');
    }
    return changed;
  }

  private async offerReload(message: string): Promise<void> {
    const pick = await vscode.window.showInformationMessage(message, RELOAD);
    if (pick === RELOAD) await vscode.commands.executeCommand('workbench.action.reloadWindow');
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
        this.log(`"node" is not on the PATH, using ${p} for the hooks.`);
        return p;
      }
    }
    this.log('Warning: "node" was not found. The hooks are registered but only run once Node.js is on the PATH.');
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
        if (uninstallHooks(file) === 'written') this.log(`Removed the hooks from ${file}.`);
        return;
      }
      const cmd = await this.hookCmd();
      const before = hookStatusOfFile(file, hookEventNames(), cmd);
      if (before.upToDate) return;
      const result = installHooks(file, hookEventNames(), cmd);
      if (result === 'written') this.log(`Registered the hooks in ${file} (${hookEventNames().length} events).`);
      const firstTime = !this.ctx.globalState.get<boolean>(HOOKS_OFFERED_KEY);
      if (result === 'written' && (firstTime || !startup) && !before.installed) {
        await this.ctx.globalState.update(HOOKS_OFFERED_KEY, true);
        void vscode.window.showInformationMessage('Claude Pets hooks have been set up.', 'Undo').then(async (pick) => {
          if (pick === 'Undo') await this.conf.update('hooks.enabled', false, vscode.ConfigurationTarget.Global);
        });
      }
    } catch (err) {
      this.log(`Could not set up the hooks: ${errText(err)}`);
      void vscode.window.showWarningMessage(`Claude Pets: ${errText(err)}`);
    }
  }

  // ----- commands & status bar ------------------------------------------------------

  private registerCommands(): void {
    const reg = (id: string, fn: () => unknown) => this.ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
    const global = vscode.ConfigurationTarget.Global;
    reg('claudePets.enable', async () => {
      if (this.enabled) await this.apply('enable');
      else await this.conf.update('enabled', true, global);
    });
    reg('claudePets.disable', async () => {
      if (!this.enabled) await this.apply('disable');
      else await this.conf.update('enabled', false, global);
    });
    reg('claudePets.reapply', async () => {
      const outcome = await this.apply('reapply');
      if (outcome === 'unchanged') {
        void this.offerReload('Claude Pets is already applied. Reload the window if the pet is missing.');
      }
    });
    reg('claudePets.chooseSpecies', () => this.chooseSpecies());
    reg('claudePets.installHooks', async () => {
      if (!this.hooksEnabled) await this.conf.update('hooks.enabled', true, global);
      else await this.syncHooks(false);
      void vscode.window.showInformationMessage('Claude Pets hooks are set up.');
    });
    reg('claudePets.removeHooks', async () => {
      if (this.hooksEnabled) await this.conf.update('hooks.enabled', false, global);
      else await this.syncHooks(false);
      void vscode.window.showInformationMessage('Claude Pets hooks have been removed.');
    });
    reg('claudePets.diagnose', () => this.diagnose());
  }

  private async chooseSpecies(): Promise<void> {
    const current = this.species;
    const items: (vscode.QuickPickItem & { id: string })[] = [...SPECIES_IDS, RANDOM_SPECIES].map((id) => ({
      id,
      label: SPECIES_LABELS[id] ?? id,
      description: id === current ? 'current' : id === RANDOM_SPECIES ? 'a different pet on every start' : undefined,
    }));
    const pick = await vscode.window.showQuickPick(items, { title: 'Claude Pets: Choose Pet', placeHolder: 'Which pet should sit on the prompt box?' });
    if (pick && pick.id !== current) await this.conf.update('species', pick.id, vscode.ConfigurationTarget.Global);
  }

  private updateStatusBar(): void {
    if (!this.enabled) {
      this.status.hide();
      return;
    }
    const setting = this.species;
    const shown = setting === RANDOM_SPECIES && this.reportedSpecies ? this.reportedSpecies : setting;
    this.status.text = `🐾 ${SPECIES_LABELS[shown] ?? shown}`;
    this.status.tooltip = 'Claude Pets – choose pet';
    this.status.show();
  }

  private diagnose(): void {
    const o = this.out;
    o.show(true);
    o.appendLine('');
    o.appendLine(`===== Claude Pets ${this.version} – Diagnostics (${new Date().toLocaleString()}) =====`);
    o.appendLine(`Enabled: ${this.enabled ? 'yes' : 'no'} · Pet: ${this.species}${this.reportedSpecies ? ` (shown: ${this.reportedSpecies})` : ''}`);
    const ext = this.findClaude();
    if (!ext) {
      o.appendLine('Claude Code: not installed');
    } else {
      const files = resolveClaudeFiles(ext.extensionPath);
      o.appendLine(`Claude Code: ${String((ext.packageJSON as { version?: string }).version)} in ${ext.extensionPath}`);
      if (files) {
        o.appendLine(`  Webview files found via: ${files.method}`);
        const st = injectionStatus({ jsPath: files.webviewJs, cssPath: files.webviewCss });
        o.appendLine(`  ${files.webviewJs}: ${st.js.present ? `patched (v${st.js.version})` : 'not patched'}`);
        o.appendLine(`  ${files.webviewCss}: ${st.css.present ? `patched (v${st.css.version})` : 'not patched'}`);
        o.appendLine(`  ${files.extensionJs ?? 'extension.js'}: CSP ${files.extensionJs ? cspStateOfFile(files.extensionJs) : 'not found'}`);
      } else {
        o.appendLine('  Webview files: not found');
      }
    }
    const cspText: Record<string, string> = {
      allowed: 'Claude Code already allows the connection',
      patched: 'variant A – connect-src extended with http://127.0.0.1:*',
      blocked: 'variant B – blocked, DOM-only mode',
      'not-found': 'no CSP found',
      disabled: 'variant B – extension switched off in the settings, DOM-only mode',
      unknown: 'unknown',
    };
    o.appendLine(`CSP: ${cspText[this.cspState] ?? this.cspState}`);
    if (this.lastPatch) {
      o.appendLine(`Last patch run: ${this.lastPatch.at.toLocaleTimeString()} → ${this.lastPatch.outcome}${this.lastPatch.detail ? ` (${this.lastPatch.detail})` : ''}`);
    }
    const file = defaultSettingsPath();
    const hs = hookStatusOfFile(file, hookEventNames(), hookCommand(this.ctx.extensionPath));
    o.appendLine(`Hooks (${file}): ${hs.error ? `error: ${hs.error}` : hs.installed ? `${hs.events.length}/${hookEventNames().length} events registered` : 'not registered'}`);
    for (const c of hs.commands) o.appendLine(`  Command: ${c}`);
    o.appendLine(`  Setting hooks.enabled: ${this.hooksEnabled ? 'on' : 'off'}`);
    o.appendLine(`Bridge: ${this.bridge?.port ? `127.0.0.1:${this.bridge.port}` : 'not running'} · connected webview clients: ${this.bridge?.clientCount ?? 0}`);
    o.appendLine(`Events received: ${this.bridge?.eventCount ?? 0}${this.bridge?.lastEventAt ? ` (last at ${new Date(this.bridge.lastEventAt).toLocaleTimeString()})` : ''}`);
    o.appendLine(`Window registration: ${path.join(petsHome(), 'instances', `${process.pid}.json`)}`);
    o.appendLine('==========================================================');
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
