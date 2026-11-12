// Appending / removing the claude-pets blocks in Claude Code's webview index.js and index.css.
// The string functions are pure; the file functions add backup + atomic write on top.
import * as vm from 'node:vm';
import { backupOnce, realFs, writeFileAtomic, type FsLike } from './fsutil';
import type { PetConfig } from './shared/types';

export const BACKUP_SUFFIX = '.claude-pets.bak';
export const END_MARKER = '/* claude-pets:end */';
const START_PREFIX = '/* claude-pets:start';

/** Matches one block including the single newline we put before and after it. */
const BLOCK_RE = /\n?\/\* claude-pets:start[^*]*\*\/[\s\S]*?\/\* claude-pets:end \*\/\n?/g;

export function jsStartMarker(version: string): string {
  return `${START_PREFIX} v${version} */`;
}
export function cssStartMarker(version: string): string {
  return `${START_PREFIX} v${version} */`;
}

/** Remove every claude-pets block. Restores the original byte for byte. */
export function stripBlock(content: string): string {
  return content.replace(BLOCK_RE, '');
}

export function hasBlock(content: string): boolean {
  BLOCK_RE.lastIndex = 0;
  const found = content.includes(START_PREFIX) && content.includes(END_MARKER);
  return found;
}

/** Version from the first start marker, or null if there is no block. */
export function blockVersion(content: string): string | null {
  const m = /\/\* claude-pets:start v([^\s*]+)/.exec(content);
  return m ? m[1] : null;
}

/** The current block text (without the surrounding newlines), or null. */
export function currentBlock(content: string): string | null {
  const m = /\/\* claude-pets:start[^*]*\*\/[\s\S]*?\/\* claude-pets:end \*\//.exec(content);
  return m ? m[0] : null;
}

/** Strip any old block and append `block` (idempotent: applying twice gives the same text). */
export function appendBlock(content: string, block: string): string {
  return stripBlock(content) + '\n' + block + '\n';
}

/** JSON that is safe inside a JS block comment-delimited region and inside <script>. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\*\//g, '*\\u002f')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
}

export function buildJsBlock(version: string, webviewJs: string, config: PetConfig): string {
  const body = webviewJs.trim().replace(/;?\s*$/, ';');
  return (
    jsStartMarker(version) +
    '\n;(function(){ try { var __CLAUDE_PETS_CONFIG__ = ' +
    safeJson(config) +
    ';\n' +
    body +
    "\n} catch (e) { console.warn('[claude-pets]', e); } })();\n" +
    END_MARKER
  );
}

export function buildCssBlock(version: string, css: string): string {
  return cssStartMarker(version) + '\n' + css.trim() + '\n' + END_MARKER;
}

/** Throws if the block is not valid strict-mode script (index.js is an ES module). */
export function validateJsBlock(block: string): void {
  new vm.Script('"use strict";\n' + block, { filename: 'claude-pets-block.js' });
}

export type PatchResult = 'written' | 'unchanged';

/** Make `file` end with exactly `block`. Creates a one-time backup first. */
export function applyBlockToFile(file: string, block: string, io: FsLike = realFs): PatchResult {
  const original = io.readFileSync(file, 'utf8');
  const next = appendBlock(original, block);
  if (next === original) return 'unchanged';
  backupOnce(file, BACKUP_SUFFIX, io);
  writeFileAtomic(file, next, io);
  return 'written';
}

export function removeBlockFromFile(file: string, io: FsLike = realFs): PatchResult {
  if (!io.existsSync(file)) return 'unchanged';
  const original = io.readFileSync(file, 'utf8');
  const next = stripBlock(original);
  if (next === original) return 'unchanged';
  writeFileAtomic(file, next, io);
  return 'written';
}

export interface InjectionTargets {
  jsPath: string;
  cssPath: string;
}

export interface InjectionStatus {
  js: { present: boolean; version: string | null };
  css: { present: boolean; version: string | null };
}

export function injectionStatus(t: InjectionTargets, io: FsLike = realFs): InjectionStatus {
  const read = (p: string) => {
    try {
      const c = io.readFileSync(p, 'utf8');
      return { present: hasBlock(c), version: blockVersion(c) };
    } catch {
      return { present: false, version: null };
    }
  };
  return { js: read(t.jsPath), css: read(t.cssPath) };
}

/**
 * Apply both blocks. If the second write fails, the first one is rolled back so the two files
 * never disagree.
 */
export function applyInjection(
  t: InjectionTargets,
  jsBlock: string,
  cssBlock: string,
  io: FsLike = realFs,
): { js: PatchResult; css: PatchResult } {
  validateJsBlock(jsBlock);
  const js = applyBlockToFile(t.jsPath, jsBlock, io);
  try {
    const css = applyBlockToFile(t.cssPath, cssBlock, io);
    return { js, css };
  } catch (err) {
    try {
      removeBlockFromFile(t.jsPath, io);
    } catch {
      /* keep original error */
    }
    throw err;
  }
}

export function removeInjection(t: InjectionTargets, io: FsLike = realFs): { js: PatchResult; css: PatchResult } {
  return { js: removeBlockFromFile(t.jsPath, io), css: removeBlockFromFile(t.cssPath, io) };
}
