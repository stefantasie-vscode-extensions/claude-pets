import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { buildSync } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { tmpDir } from './helpers';

let hookJs = '';

beforeAll(() => {
  const out = path.join(tmpDir(), 'hook.js');
  buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'hook.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  hookJs = out;
});

function runHook(home: string, input: string) {
  return spawnSync(process.execPath, [hookJs], {
    input,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    timeout: 10000,
  });
}

const payload = JSON.stringify({
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd: '/work/project',
  prompt: 'geheim',
  tool_name: 'Bash',
  tool_input: { command: 'npm test', description: 'secret description' },
});

describe('hook.js', () => {
  it('writes nothing and exits 0 without a running bridge', () => {
    const home = tmpDir();
    const r = runHook(home, payload);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('exits 0 silently on garbage input and on a dead registered port', () => {
    const home = tmpDir();
    const dir = path.join(home, '.claude-pets', 'instances');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '999999.json'), JSON.stringify({ pid: 999999, port: 1, token: 't', workspaceFolders: [], startedAt: '', version: '' }));
    for (const input of ['', 'not json', '[]', payload]) {
      const started = Date.now();
      const r = runHook(home, input);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
      expect(Date.now() - started).toBeLessThan(5000);
    }
  });

  it('posts a slimmed payload with the token to the matching instance', async () => {
    const received: { token: string | undefined; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ token: req.headers['x-claude-pets-token'] as string | undefined, body });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    const home = tmpDir();
    const dir = path.join(home, '.claude-pets', 'instances');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, port, token: 'tok', workspaceFolders: ['/work/project'], startedAt: '', version: '' }));
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [hookJs], { env: { ...process.env, HOME: home, USERPROFILE: home } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.stdin.end(payload);
    const code = await new Promise<number | null>((r) => child.on('close', r));
    server.close();
    expect(code).toBe(0);
    expect(out).toBe('');
    expect(received).toHaveLength(1);
    expect(received[0].token).toBe('tok');
    const body = JSON.parse(received[0].body);
    expect(body).toMatchObject({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    expect(received[0].body).not.toContain('geheim');
    expect(received[0].body).not.toContain('secret description');
  });
});
