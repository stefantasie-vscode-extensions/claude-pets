import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SETTINGS_BACKUP_SUFFIX,
  SettingsParseError,
  hookCommand,
  hookStatusOfFile,
  installHooks,
  isOwnHandler,
  uninstallHooks,
} from '../src/hooksInstaller';
import { tmpDir } from './helpers';

const events = ['PreToolUse', 'Stop', 'Notification'];
const cmd010 = hookCommand('/home/u/.vscode/extensions/stefantasie.claude-pets-0.1.0');
const cmd020 = hookCommand('/home/u/.vscode/extensions/stefantasie.claude-pets-0.2.0');

function read(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('hooksInstaller', () => {
  it('creates a missing settings.json (and its folder)', () => {
    const file = path.join(tmpDir(), '.claude', 'settings.json');
    expect(installHooks(file, events, cmd010)).toBe('written');
    const s = read(file);
    expect(Object.keys(s.hooks)).toEqual(events);
    expect(s.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: cmd010, async: true }] }]);
    expect(fs.existsSync(file + SETTINGS_BACKUP_SUFFIX)).toBe(false);
  });

  it('treats an empty file like {}', () => {
    const file = path.join(tmpDir(), 'settings.json');
    fs.writeFileSync(file, '  \n');
    expect(installHooks(file, events, cmd010)).toBe('written');
    expect(read(file).hooks.PreToolUse).toHaveLength(1);
    expect(fs.readFileSync(file + SETTINGS_BACKUP_SUFFIX, 'utf8')).toBe('  \n');
  });

  it('keeps foreign hooks and other settings untouched', () => {
    const file = path.join(tmpDir(), 'settings.json');
    const foreign = {
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/x/guard.sh' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    };
    fs.writeFileSync(file, JSON.stringify(foreign, null, 4));
    installHooks(file, events, cmd010);
    const s = read(file);
    expect(s.model).toBe('opus');
    expect(s.hooks.Stop[0]).toEqual(foreign.hooks.Stop[0]);
    expect(s.hooks.Stop[1].hooks[0].command).toBe(cmd010);
    expect(s.hooks.PreToolUse[0]).toEqual(foreign.hooks.PreToolUse[0]);
    expect(s.hooks.SessionStart).toEqual(foreign.hooks.SessionStart);
    // indentation of the user's file is kept
    expect(fs.readFileSync(file, 'utf8')).toContain('\n    "model"');
    expect(read(file + SETTINGS_BACKUP_SUFFIX)).toEqual(foreign);
  });

  it('replaces own entries instead of duplicating them (new extension version)', () => {
    const file = path.join(tmpDir(), 'settings.json');
    installHooks(file, events, cmd010);
    expect(installHooks(file, events, cmd010)).toBe('unchanged');
    installHooks(file, events, cmd020);
    const s = read(file);
    for (const e of events) {
      expect(s.hooks[e]).toHaveLength(1);
      expect(s.hooks[e][0].hooks[0].command).toBe(cmd020);
    }
    expect(hookStatusOfFile(file, events, cmd020).upToDate).toBe(true);
    expect(hookStatusOfFile(file, events, cmd010).upToDate).toBe(false);
  });

  it('removes only own hooks and leaves foreign ones', () => {
    const file = path.join(tmpDir(), 'settings.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }, { type: 'command', command: cmd010, async: true }] }] } }),
    );
    installHooks(file, events, cmd010);
    expect(uninstallHooks(file)).toBe('written');
    expect(read(file)).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } });
    expect(uninstallHooks(file)).toBe('unchanged');
  });

  it('drops the hooks object when nothing else is left', () => {
    const file = path.join(tmpDir(), 'settings.json');
    fs.writeFileSync(file, '{\n  "theme": "dark"\n}\n');
    installHooks(file, events, cmd010);
    uninstallHooks(file);
    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "theme": "dark"\n}\n');
  });

  it('refuses to overwrite invalid JSON', () => {
    const file = path.join(tmpDir(), 'settings.json');
    fs.writeFileSync(file, '{ "model": "opus", }');
    expect(() => installHooks(file, events, cmd010)).toThrow(SettingsParseError);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ "model": "opus", }');
    expect(() => uninstallHooks(file)).toThrow(SettingsParseError);
    expect(hookStatusOfFile(file, events, cmd010).error).toBeTruthy();
  });

  it('recognises own handlers by the claude-pets path component', () => {
    expect(isOwnHandler({ command: 'node "C:\\Users\\x\\.vscode\\extensions\\stefantasie.claude-pets-0.1.0\\dist\\hook.js"' })).toBe(true);
    expect(isOwnHandler({ command: cmd010 })).toBe(true);
    expect(isOwnHandler({ command: 'node /opt/other/dist/hook.js' })).toBe(false);
    expect(isOwnHandler({ command: 'echo claude-pets' })).toBe(false);
  });
});
