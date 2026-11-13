// Merging our async command hooks into ~/.claude/settings.json without touching foreign hooks.
import { mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { backupOnce, realFs, writeFileAtomic, type FsLike } from './fsutil';

export const SETTINGS_BACKUP_SUFFIX = '.claude-pets.bak';

/** Our entries are recognised by the claude-pets path component in front of dist/hook.js. */
const OWN_COMMAND_RE = /claude-pets[^"'\s]*[\\/]+dist[\\/]+hook\.js/;

export class SettingsParseError extends Error {
  constructor(file: string, cause: unknown) {
    super(`${file} does not contain valid JSON (${cause instanceof Error ? cause.message : String(cause)}). The file was left unchanged.`);
    this.name = 'SettingsParseError';
  }
}

type Json = Record<string, unknown>;
interface HookHandler {
  type?: string;
  command?: string;
  async?: boolean;
  [k: string]: unknown;
}
interface MatcherGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [k: string]: unknown;
}

export function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/** The command line we register, e.g. node "/Users/x/.vscode/extensions/stefantasie.claude-pets-0.2.0/dist/hook.js". */
export function hookCommand(extensionPath: string, nodeBinary = 'node'): string {
  const script = path.join(extensionPath, 'dist', 'hook.js');
  const node = /\s/.test(nodeBinary) ? `"${nodeBinary}"` : nodeBinary;
  return `${node} "${script}"`;
}

export function isOwnHandler(h: unknown): boolean {
  return typeof h === 'object' && h !== null && typeof (h as HookHandler).command === 'string' && OWN_COMMAND_RE.test((h as HookHandler).command as string);
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Remove our handlers; drop groups/events/hooks object that become empty because of that. */
export function removeOwnHooks(settings: Json): Json {
  const out: Json = { ...settings };
  if (!isObj(out.hooks)) return out;
  const hooks: Json = {};
  for (const [event, groups] of Object.entries(out.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept: unknown[] = [];
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray((g as MatcherGroup).hooks)) {
        kept.push(g);
        continue;
      }
      const handlers = ((g as MatcherGroup).hooks as unknown[]).filter((h) => !isOwnHandler(h));
      if (handlers.length === ((g as MatcherGroup).hooks as unknown[]).length) kept.push(g);
      else if (handlers.length > 0) kept.push({ ...g, hooks: handlers });
    }
    if (kept.length > 0 || groups.length === 0) hooks[event] = kept;
  }
  if (Object.keys(hooks).length === 0) delete out.hooks;
  else out.hooks = hooks;
  return out;
}

/** Add one async command handler per event (replacing previous own entries). */
export function mergeOwnHooks(settings: Json, events: string[], command: string): Json {
  const out = removeOwnHooks(settings);
  const hooks: Json = isObj(out.hooks) ? { ...out.hooks } : {};
  for (const event of events) {
    const groups = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    groups.push({ hooks: [{ type: 'command', command, async: true }] });
    hooks[event] = groups;
  }
  out.hooks = hooks;
  return out;
}

export interface HookStatus {
  installed: boolean;
  events: string[];
  commands: string[];
  upToDate: boolean;
  error?: string;
}

export function ownHookStatus(settings: Json, expectedEvents: string[], expectedCommand: string): HookStatus {
  const events: string[] = [];
  const commands = new Set<string>();
  if (isObj(settings.hooks)) {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!isObj(g) || !Array.isArray((g as MatcherGroup).hooks)) continue;
        for (const h of (g as MatcherGroup).hooks as unknown[]) {
          if (isOwnHandler(h)) {
            if (!events.includes(event)) events.push(event);
            commands.add((h as HookHandler).command as string);
          }
        }
      }
    }
  }
  const upToDate =
    commands.size === 1 && commands.has(expectedCommand) && expectedEvents.every((e) => events.includes(e)) && events.length === expectedEvents.length;
  return { installed: events.length > 0, events, commands: [...commands], upToDate };
}

function detectIndent(text: string): string | number {
  const m = /\n([ \t]+)"/.exec(text);
  if (!m) return 2;
  return m[1].includes('\t') ? '\t' : m[1].length;
}

/** Parse settings.json. Missing or empty file → {}. Invalid JSON → SettingsParseError. */
export function readSettings(file: string, io: FsLike = realFs): { data: Json; raw: string | null } {
  if (!io.existsSync(file)) return { data: {}, raw: null };
  const raw = io.readFileSync(file, 'utf8');
  if (raw.trim() === '') return { data: {}, raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SettingsParseError(file, err);
  }
  if (!isObj(parsed)) throw new SettingsParseError(file, new Error('the root is not an object'));
  return { data: parsed, raw };
}

function serialize(data: Json, raw: string | null): string {
  return JSON.stringify(data, null, raw ? detectIndent(raw) : 2) + '\n';
}

export type InstallResult = 'written' | 'unchanged';

function writeSettings(file: string, data: Json, raw: string | null, io: FsLike, mkdir: (dir: string) => void): InstallResult {
  const next = serialize(data, raw);
  // Semantically unchanged → leave the user's file (and its formatting) alone.
  if (raw !== null && (next === raw || JSON.stringify(JSON.parse(raw.trim() === '' ? '{}' : raw)) === JSON.stringify(data))) {
    return 'unchanged';
  }
  if (raw === null) mkdir(path.dirname(file));
  else backupOnce(file, SETTINGS_BACKUP_SUFFIX, io);
  writeFileAtomic(file, next, io);
  return 'written';
}

export function installHooks(
  file: string,
  events: string[],
  command: string,
  io: FsLike = realFs,
  mkdir: (dir: string) => void = defaultMkdir,
): InstallResult {
  const { data, raw } = readSettings(file, io);
  return writeSettings(file, mergeOwnHooks(data, events, command), raw, io, mkdir);
}

export function uninstallHooks(file: string, io: FsLike = realFs): InstallResult {
  if (!io.existsSync(file)) return 'unchanged';
  const { data, raw } = readSettings(file, io);
  return writeSettings(file, removeOwnHooks(data), raw, io, defaultMkdir);
}

export function hookStatusOfFile(file: string, events: string[], command: string, io: FsLike = realFs): HookStatus {
  try {
    return ownHookStatus(readSettings(file, io).data, events, command);
  } catch (err) {
    return { installed: false, events: [], commands: [], upToDate: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function defaultMkdir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
