import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCspPatch, cspAllowsBridge, cspState, findCsps, patchCspSource, removeCspPatch, removeCspPatchSource } from '../src/csp';
import { tmpDir } from './helpers';

// Shape of Claude Code 2.1.322's getHtmlForWebview().
const claudeLike =
  'class P{getHtmlForWebview(e){let d=n(),h=`style-src ${e.cspSource}`,v=`worker-src ${e.cspSource}`;return`<!DOCTYPE html>\n' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ${h}; script-src \'nonce-${d}\'; ${v};">\n' +
  '<script nonce="${d}" src="x/webview/index.js"></script>`}}\n' +
  'var plan=`<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-{{NONCE}}\';">`;\n';

describe('csp', () => {
  it('finds only the templated webview CSP', () => {
    expect(findCsps(claudeLike)).toHaveLength(1);
    expect(cspState(claudeLike)).toBe('blocked');
  });

  it('adds connect-src inside a template expression and removes it again exactly', () => {
    const patched = patchCspSource(claudeLike);
    expect(patched).toContain("${' connect-src http://127.0.0.1:* http://localhost:*;'/*claude-pets:csp*/}");
    expect(cspState(patched)).toBe('patched');
    expect(patchCspSource(patched)).toBe(patched);
    expect(removeCspPatchSource(patched)).toBe(claudeLike);
    // The patched template literal must still evaluate to a valid policy.
    const P = new Function(patched + '; return P;')() as new () => { getHtmlForWebview(e: unknown): string };
    globalThis.n = () => 'NONCE';
    const html = new P().getHtmlForWebview({ cspSource: 'vscode-resource:' });
    expect(html).toContain("script-src 'nonce-NONCE'; worker-src vscode-resource:; connect-src http://127.0.0.1:* http://localhost:*;\"");
  });

  it('extends an existing connect-src instead of adding a second one', () => {
    const src = 'x=`<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src https://api.example; script-src \'nonce-${d}\'">`';
    const patched = patchCspSource(src);
    expect(patched).toContain("connect-src${' http://127.0.0.1:* http://localhost:*'/*claude-pets:csp*/} https://api.example");
    expect(removeCspPatchSource(patched)).toBe(src);
  });

  it('recognises policies that already allow the bridge', () => {
    expect(cspAllowsBridge("default-src 'none'; connect-src http://127.0.0.1:*")).toBe(true);
    expect(cspAllowsBridge("default-src *")).toBe(true);
    expect(cspAllowsBridge("default-src 'none'; script-src 'nonce-${d}'")).toBe(false);
    expect(cspAllowsBridge("script-src 'self'")).toBe(true);
  });

  it('patches a file with backup and restores it', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'extension.js');
    fs.writeFileSync(file, claudeLike);
    expect(applyCspPatch(file)).toBe('written');
    expect(applyCspPatch(file)).toBe('unchanged');
    expect(fs.readFileSync(file + '.claude-pets.bak', 'utf8')).toBe(claudeLike);
    expect(removeCspPatch(file)).toBe('written');
    expect(fs.readFileSync(file, 'utf8')).toBe(claudeLike);
  });
});

declare global {
  // eslint-disable-next-line no-var
  var n: () => string;
}
