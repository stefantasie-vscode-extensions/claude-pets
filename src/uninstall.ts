// dist/uninstall.js – run by VS Code ("vscode:uninstall") after Claude Pets was uninstalled.
// Removes the injected blocks and the CSP addition from every installed Claude Code version,
// our hooks from ~/.claude/settings.json and the ~/.claude-pets folder. Never throws.
//
// If another Claude Pets installation is still registered (e.g. after the publisher changed
// from "kleywalker" to "stefantasie"), nothing is removed: that installation owns the patches.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findClaudeInstallations, resolveClaudeFiles } from './claudeLocator';
import { removeCspPatch } from './csp';
import { defaultSettingsPath, uninstallHooks } from './hooksInstaller';
import { BACKUP_SUFFIX, removeInjection } from './injector';
import { petsHome } from './instances';

function tryRun(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[claude-pets] ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Delete our backup if it is byte-identical to the (now unpatched) file. */
function dropRedundantBackup(file: string): void {
  const backup = file + BACKUP_SUFFIX;
  if (!fs.existsSync(backup) || !fs.existsSync(file)) return;
  if (fs.readFileSync(backup).equals(fs.readFileSync(file))) fs.unlinkSync(backup);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Other Claude Pets installations that are still registered next to this one. VS Code removes
 * an uninstalled extension from extensions.json right away and lists it in ".obsolete".
 */
export function otherInstallations(ownDir: string): string[] {
  const root = path.dirname(ownDir);
  const ownName = path.basename(ownDir);
  const obsolete = readJson<Record<string, boolean>>(path.join(root, '.obsolete')) ?? {};
  const registry = readJson<{ relativeLocation?: string; identifier?: { id?: string } }[]>(path.join(root, 'extensions.json'));
  const isPets = (name: string) => /\.claude-pets-\d+\.\d+\.\d+/.test(name);
  if (Array.isArray(registry)) {
    return registry
      .map((e) => e.relativeLocation ?? '')
      .filter((name) => isPets(name) && name !== ownName && !obsolete[name] && fs.existsSync(path.join(root, name)));
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((name) => isPets(name) && name !== ownName && !obsolete[name]);
}

export function uninstallEverything(): void {
  for (const dir of findClaudeInstallations()) {
    const files = resolveClaudeFiles(dir);
    if (!files) continue;
    tryRun(`injection in ${dir}`, () => removeInjection({ jsPath: files.webviewJs, cssPath: files.webviewCss }));
    if (files.extensionJs) tryRun(`CSP in ${dir}`, () => removeCspPatch(files.extensionJs!));
    for (const f of [files.webviewJs, files.webviewCss, files.extensionJs]) {
      if (f) tryRun(`backup of ${f}`, () => dropRedundantBackup(f));
    }
  }
  tryRun('hooks', () => uninstallHooks(defaultSettingsPath()));
  tryRun('~/.claude-pets', () => fs.rmSync(petsHome(), { recursive: true, force: true }));
}

if (require.main === module) {
  const others = otherInstallations(path.resolve(__dirname, '..'));
  if (others.length > 0) {
    console.log(`[claude-pets] Another installation is still present (${others.join(', ')}); leaving its patches and hooks in place.`);
  } else {
    uninstallEverything();
  }
}
