// dist/uninstall.js – run by VS Code ("vscode:uninstall") after Claude Pets was uninstalled.
// Removes the injected blocks and the CSP addition from every installed Claude Code version,
// our hooks from ~/.claude/settings.json and the ~/.claude-pets folder. Never throws.
import * as fs from 'node:fs';
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

export function uninstallEverything(): void {
  for (const dir of findClaudeInstallations()) {
    const files = resolveClaudeFiles(dir);
    if (!files) continue;
    tryRun(`Injektion in ${dir}`, () => removeInjection({ jsPath: files.webviewJs, cssPath: files.webviewCss }));
    if (files.extensionJs) tryRun(`CSP in ${dir}`, () => removeCspPatch(files.extensionJs!));
    for (const f of [files.webviewJs, files.webviewCss, files.extensionJs]) {
      if (f) tryRun(`Sicherung ${f}`, () => dropRedundantBackup(f));
    }
  }
  tryRun('Hooks', () => uninstallHooks(defaultSettingsPath()));
  tryRun('~/.claude-pets', () => fs.rmSync(petsHome(), { recursive: true, force: true }));
}

uninstallEverything();
