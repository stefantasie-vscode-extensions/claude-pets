import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FsLike } from '../src/fsutil';
import {
  BACKUP_SUFFIX,
  appendBlock,
  applyBlockToFile,
  blockPayload,
  applyInjection,
  blockVersion,
  buildCssBlock,
  buildJsBlock,
  hasBlock,
  removeBlockFromFile,
  removeInjection,
  stripBlock,
  validateJsBlock,
} from '../src/injector';
import type { PetConfig } from '../src/shared/types';
import { tmpDir } from './helpers';

const config: PetConfig = {
  version: '0.1.0',
  species: 'dog',
  scale: 2,
  showButtons: true,
  wander: true,
  sleepAfterMs: 240000,
  opacityOnHover: 0.35,
  reduceMotion: 'auto',
  debug: false,
  bridge: { enabled: true, ports: [47811], token: 'abc' },
};

const js = (v = '0.1.0', body = 'console.log("pet")') => buildJsBlock(v, body, config);

describe('injector (strings)', () => {
  const original = 'function claude(){}\nclaude();\n';

  it('appends a block that can be removed again byte for byte', () => {
    const patched = appendBlock(original, js());
    expect(patched.startsWith(original)).toBe(true);
    expect(hasBlock(patched)).toBe(true);
    expect(patched).toContain('/* claude-pets:start v0.1.0 */');
    expect(patched.trimEnd().endsWith('/* claude-pets:end */')).toBe(true);
    expect(stripBlock(patched)).toBe(original);
  });

  it('does not grow when applied twice', () => {
    const once = appendBlock(original, js());
    const twice = appendBlock(once, js());
    expect(twice).toBe(once);
    expect(twice.match(/claude-pets:start/g)).toHaveLength(1);
  });

  it('replaces the block on a version change', () => {
    const v1 = appendBlock(original, js('0.1.0'));
    const v2 = appendBlock(v1, js('0.2.0', 'console.log("v2")'));
    expect(blockVersion(v2)).toBe('0.2.0');
    expect(v2.match(/claude-pets:start/g)).toHaveLength(1);
    expect(v2).not.toContain('"pet"');
    expect(stripBlock(v2)).toBe(original);
  });

  it('handles files without a trailing newline', () => {
    const noNl = 'var a=1;try{x()}catch(e){y(e)}';
    const patched = appendBlock(noNl, js());
    expect(patched.startsWith(noNl + '\n/* claude-pets:start')).toBe(true);
    expect(stripBlock(patched)).toBe(noNl);
    expect(stripBlock(appendBlock(patched, js()))).toBe(noNl);
  });

  it('removes several stray blocks at once', () => {
    const messy = original + '\n' + js() + '\n' + 'tail();' + '\n' + js('0.0.9') + '\n';
    expect(stripBlock(messy)).toBe(original + 'tail();');
  });

  it('wraps the payload in try/catch with the embedded config and validates as strict script', () => {
    const block = js();
    expect(block).toContain('var __CLAUDE_PETS_CONFIG__ = {');
    expect(block).toContain("catch (e) { console.warn('[claude-pets]', e); }");
    expect(() => validateJsBlock(block)).not.toThrow();
    expect(() => validateJsBlock(buildJsBlock('0.1.0', 'function (', config))).toThrow();
  });

  it('escapes the config so it cannot close a comment or a script tag', () => {
    const evil = buildJsBlock('0.1.0', '', { ...config, species: '*/</script>' });
    expect(evil).not.toContain('*/</script>');
    expect(() => validateJsBlock(evil)).not.toThrow();
  });

  it('separates the reload-relevant payload from the live configuration', () => {
    const a = buildJsBlock('0.1.0', 'console.log(1)', config);
    const b = buildJsBlock('0.1.0', 'console.log(1)', { ...config, species: 'katze', scale: 3 });
    expect(blockPayload(a)).toBe(blockPayload(b));
    expect(blockPayload(a)).not.toContain('__CLAUDE_PETS_CONFIG__');
    expect(blockPayload(buildJsBlock('0.1.1', 'console.log(1)', config))).not.toBe(blockPayload(a));
    expect(blockPayload(buildJsBlock('0.1.0', 'console.log(2)', config))).not.toBe(blockPayload(a));
  });

  it('builds a css block with markers', () => {
    const css = buildCssBlock('0.1.0', '#claude-pets-root{position:fixed}');
    const patched = appendBlock('.a{}', css);
    expect(patched).toContain('/* claude-pets:start v0.1.0 */\n#claude-pets-root{position:fixed}\n/* claude-pets:end */');
    expect(stripBlock(patched)).toBe('.a{}');
  });
});

describe('injector (files)', () => {
  it('backs up once, writes atomically and removes cleanly', () => {
    const dir = tmpDir();
    const jsPath = path.join(dir, 'index.js');
    const cssPath = path.join(dir, 'index.css');
    fs.writeFileSync(jsPath, 'original();');
    fs.writeFileSync(cssPath, '.x{}\n');
    const r1 = applyInjection({ jsPath, cssPath }, js(), buildCssBlock('0.1.0', '.pet{}'));
    expect(r1).toEqual({ js: 'written', css: 'written' });
    expect(fs.readFileSync(jsPath + BACKUP_SUFFIX, 'utf8')).toBe('original();');
    const r2 = applyInjection({ jsPath, cssPath }, js(), buildCssBlock('0.1.0', '.pet{}'));
    expect(r2).toEqual({ js: 'unchanged', css: 'unchanged' });
    // A later patch must not overwrite the backup with a patched file.
    applyBlockToFile(jsPath, js('0.2.0'));
    expect(fs.readFileSync(jsPath + BACKUP_SUFFIX, 'utf8')).toBe('original();');
    expect(removeInjection({ jsPath, cssPath })).toEqual({ js: 'written', css: 'written' });
    expect(fs.readFileSync(jsPath, 'utf8')).toBe('original();');
    expect(fs.readFileSync(cssPath, 'utf8')).toBe('.x{}\n');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(removeBlockFromFile(jsPath)).toBe('unchanged');
  });

  it('leaves the original untouched when writing fails', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'index.js');
    fs.writeFileSync(file, 'keep();');
    const failing: FsLike = {
      ...(fs as unknown as FsLike),
      readFileSync: (p, enc) => fs.readFileSync(p, enc),
      writeFileSync: () => {
        throw new Error('disk full');
      },
      renameSync: (a, b) => fs.renameSync(a, b),
      existsSync: (p) => fs.existsSync(p),
      copyFileSync: (a, b) => fs.copyFileSync(a, b),
      unlinkSync: (p) => fs.unlinkSync(p),
      statSync: (p) => fs.statSync(p),
    };
    expect(() => applyBlockToFile(file, js(), failing)).toThrow('disk full');
    expect(fs.readFileSync(file, 'utf8')).toBe('keep();');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('rolls back index.js when index.css cannot be written', () => {
    const dir = tmpDir();
    const jsPath = path.join(dir, 'index.js');
    const cssPath = path.join(dir, 'missing', 'index.css');
    fs.writeFileSync(jsPath, 'original();');
    expect(() => applyInjection({ jsPath, cssPath }, js(), buildCssBlock('0.1.0', '.p{}'))).toThrow();
    expect(fs.readFileSync(jsPath, 'utf8')).toBe('original();');
  });

  it('refuses a syntactically broken block before touching anything', () => {
    const dir = tmpDir();
    const jsPath = path.join(dir, 'index.js');
    const cssPath = path.join(dir, 'index.css');
    fs.writeFileSync(jsPath, 'original();');
    fs.writeFileSync(cssPath, '');
    expect(() => applyInjection({ jsPath, cssPath }, buildJsBlock('0.1.0', 'if (', config), '')).toThrow();
    expect(fs.readFileSync(jsPath, 'utf8')).toBe('original();');
    expect(fs.existsSync(jsPath + BACKUP_SUFFIX)).toBe(false);
  });
});
