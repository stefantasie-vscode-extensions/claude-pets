// Content-Security-Policy of Claude Code's webview: analyse and (optionally) extend connect-src
// so the injected script may talk to the local bridge on http://127.0.0.1.
//
// Claude Code builds its webview HTML in extension.js inside a template literal, e.g.
//   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${h}; ...; script-src 'nonce-${d}'; ${v};">
// We insert a template expression whose JS comment acts as the marker:
//   ${' connect-src http://127.0.0.1:* http://localhost:*;'/*claude-pets:csp*/}
// Removing exactly that expression restores the original byte for byte.
import * as vm from 'node:vm';
import { backupOnce, realFs, writeFileAtomic, type FsLike } from './fsutil';

export const CSP_MARK = '/*claude-pets:csp*/';
export const CSP_SOURCES = 'http://127.0.0.1:* http://localhost:*';
const META_PREFIX = 'http-equiv="Content-Security-Policy" content="';
const PATCH_RE = /\$\{'[^'`$]*'\/\*claude-pets:csp\*\/\}/g;

export type CspState = 'allowed' | 'patched' | 'blocked' | 'not-found';

interface CspLocation {
  /** Index of the first character of the content attribute value. */
  start: number;
  /** Index of the closing quote. */
  end: number;
  content: string;
}

/** CSP meta tags that belong to a templated webview HTML (script nonce comes from ${...}). */
export function findCsps(src: string): CspLocation[] {
  const out: CspLocation[] = [];
  let i = 0;
  while ((i = src.indexOf(META_PREFIX, i)) >= 0) {
    const start = i + META_PREFIX.length;
    const end = src.indexOf('"', start);
    if (end < 0) break;
    const content = src.slice(start, end);
    if (/script-src[^;]*'nonce-\$\{/.test(content)) out.push({ start, end, content });
    i = end;
  }
  return out;
}

function directives(content: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  // Template expressions such as ${h} expand to whole directives at runtime; they are opaque
  // to us, except for our own marker expression, which we evaluate.
  const expanded = content.replace(PATCH_RE, (m) => m.slice(3, m.indexOf("'", 3)));
  for (const part of expanded.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens[0].startsWith('${')) continue;
    const name = tokens[0].toLowerCase();
    if (!map.has(name)) map.set(name, tokens.slice(1));
  }
  return map;
}

function allowsLocalhost(sources: string[] | undefined): boolean {
  if (!sources) return false;
  return sources.some((s) => {
    const v = s.toLowerCase();
    return v === '*' || v === 'http:' || v === 'http://127.0.0.1:*' || v === 'http://127.0.0.1' || v.startsWith('http://127.0.0.1:');
  });
}

/** Does this CSP content let fetch()/EventSource reach http://127.0.0.1? */
export function cspAllowsBridge(content: string): boolean {
  const d = directives(content);
  if (d.has('connect-src')) return allowsLocalhost(d.get('connect-src'));
  if (d.has('default-src')) return allowsLocalhost(d.get('default-src'));
  return true; // no restriction at all
}

export function cspState(src: string): CspState {
  const csps = findCsps(src);
  if (csps.length === 0) return 'not-found';
  if (src.includes(CSP_MARK) && csps.every((c) => cspAllowsBridge(c.content))) return 'patched';
  return csps.every((c) => cspAllowsBridge(c.content)) ? 'allowed' : 'blocked';
}

/** Insert our connect-src sources into every templated CSP that blocks the bridge. */
export function patchCspSource(src: string): string {
  let out = removeCspPatchSource(src);
  const csps = findCsps(out).filter((c) => !cspAllowsBridge(c.content));
  // Work from the end so earlier indices stay valid.
  for (const c of csps.reverse()) {
    const m = /connect-src/i.exec(c.content);
    if (m) {
      const at = c.start + m.index + m[0].length;
      out = out.slice(0, at) + `\${' ${CSP_SOURCES}'${CSP_MARK}}` + out.slice(at);
    } else {
      const sep = c.content.trimEnd().endsWith(';') ? ' ' : '; ';
      out = out.slice(0, c.end) + `\${'${sep}connect-src ${CSP_SOURCES};'${CSP_MARK}}` + out.slice(c.end);
    }
  }
  return out;
}

export function removeCspPatchSource(src: string): string {
  return src.replace(PATCH_RE, '');
}

export type CspPatchResult = 'written' | 'unchanged' | 'not-found';

/** Patch Claude Code's extension.js on disk (backup, syntax check, atomic write). */
export function applyCspPatch(extensionJs: string, io: FsLike = realFs): CspPatchResult {
  const original = io.readFileSync(extensionJs, 'utf8');
  if (findCsps(original).length === 0) return 'not-found';
  const next = patchCspSource(original);
  if (next === original) return 'unchanged';
  // extension.js is CommonJS: it must still compile as a script after our edit.
  new vm.Script(next, { filename: 'extension.js' });
  backupOnce(extensionJs, '.claude-pets.bak', io);
  writeFileAtomic(extensionJs, next, io);
  return 'written';
}

export function removeCspPatch(extensionJs: string, io: FsLike = realFs): 'written' | 'unchanged' {
  if (!io.existsSync(extensionJs)) return 'unchanged';
  const original = io.readFileSync(extensionJs, 'utf8');
  const next = removeCspPatchSource(original);
  if (next === original) return 'unchanged';
  writeFileAtomic(extensionJs, next, io);
  return 'written';
}

export function cspStateOfFile(extensionJs: string, io: FsLike = realFs): CspState {
  try {
    return cspState(io.readFileSync(extensionJs, 'utf8'));
  } catch {
    return 'not-found';
  }
}
