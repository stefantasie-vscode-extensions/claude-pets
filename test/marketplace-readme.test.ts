import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmpDir } from './helpers';

const script = path.join(__dirname, '..', 'scripts', 'marketplace-readme.mjs');

function run(readme: string) {
  const dir = tmpDir();
  const input = path.join(dir, 'README.md');
  const output = path.join(dir, 'README.marketplace.md');
  fs.writeFileSync(input, readme);
  const r = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, text: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null };
}

describe('marketplace README', () => {
  it('drops GitHub-only blocks and keeps everything else', () => {
    const r = run('# Title\n\n<!-- github-only -->\n[Install](https://example.com)\n<!-- /github-only -->\n\nBody text.\n');
    expect(r.status).toBe(0);
    expect(r.text).toBe('# Title\n\nBody text.\n');
  });

  it('handles several blocks', () => {
    const r = run('a\n<!-- github-only -->x<!-- /github-only -->\nb\n<!-- github-only -->\ny\n<!-- /github-only -->\nc\n');
    expect(r.text).toBe('a\n\nb\n\nc\n');
  });

  it('fails on unbalanced markers', () => {
    expect(run('a\n<!-- github-only -->\nb\n').status).not.toBe(0);
    expect(run('a\n<!-- /github-only -->\nb\n').status).not.toBe(0);
  });

  it('removes the Marketplace link from the real README', () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    expect(readme).toContain('itemName=stefantasie.claude-pets');
    const r = run(readme);
    expect(r.status).toBe(0);
    expect(r.text).not.toContain('itemName=stefantasie.claude-pets');
    expect(r.text).toContain('Support me on Ko-fi');
  });
});
