import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Bridge } from '../src/bridge';
import type { PetConfig } from '../src/shared/types';

let bridge: Bridge | null = null;
afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

function request(port: number, method: string, path: string, opts: { body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: opts.headers, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

async function start(onSpecies?: (s: string, p: boolean) => void) {
  bridge = new Bridge({ token: 'secret-token', version: '0.1.0', workspaceFolders: () => ['/w'], portFirst: 47930, portLast: 47939, onSpecies });
  const port = await bridge.start();
  expect(port).not.toBeNull();
  return port!;
}

describe('bridge', () => {
  it('binds the first free port of its range', async () => {
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(47930, '127.0.0.1', () => r()));
    try {
      expect(await start()).toBe(47931);
    } finally {
      blocker.close();
    }
  });

  it('requires the token', async () => {
    const port = await start();
    expect((await request(port, 'GET', '/hello')).status).toBe(403);
    expect((await request(port, 'GET', '/hello?token=wrong')).status).toBe(403);
    const ok = await request(port, 'GET', '/hello?token=secret-token');
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ ok: true, workspaceFolders: ['/w'], version: '0.1.0' });
    expect((await request(port, 'POST', '/event', { body: '{}' })).status).toBe(403);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const port = await start();
    expect((await request(port, 'GET', '/hello?token=secret-token', { headers: { Host: 'evil.example:80' } })).status).toBe(403);
  });

  it('streams sanitized events and config over SSE', async () => {
    const port = await start();
    const chunks: string[] = [];
    const sse = http.get({ host: '127.0.0.1', port, path: '/events?token=secret-token', agent: false });
    const res = await new Promise<http.IncomingMessage>((r) => sse.on('response', r));
    res.setEncoding('utf8');
    res.on('data', (c: string) => chunks.push(c));
    await new Promise((r) => setTimeout(r, 50));
    expect(bridge!.clientCount).toBe(1);
    const post = await request(port, 'POST', '/event', {
      headers: { 'x-claude-pets-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'x', prompt: 'geheim', tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }),
    });
    expect(post.status).toBe(204);
    bridge!.pushConfig({ species: 'katze' } as PetConfig);
    await new Promise((r) => setTimeout(r, 50));
    const text = chunks.join('');
    expect(text).toContain('event: hello');
    expect(text).toContain('event: hook');
    expect(text).toContain('"event":"PreToolUse"');
    expect(text).toContain('"tool":"Read"');
    expect(text).not.toContain('geheim');
    expect(text).not.toContain('passwd');
    expect(text).toContain('event: config');
    expect(bridge!.eventCount).toBe(1);
    sse.destroy();
  });

  it('accepts species reports from the webview', async () => {
    const got: [string, boolean][] = [];
    const port = await start((s, p) => got.push([s, p]));
    expect((await request(port, 'POST', '/species?token=secret-token', { body: JSON.stringify({ species: 'katze', persist: true }) })).status).toBe(204);
    expect((await request(port, 'POST', '/species?token=secret-token', { body: JSON.stringify({ species: '../x' }) })).status).toBe(400);
    expect(got).toEqual([['katze', true]]);
  });

  it('answers CORS preflights for the webview origin', async () => {
    const port = await start();
    const r = await new Promise<http.IncomingMessage>((resolve) =>
      http.request({ host: '127.0.0.1', port, method: 'OPTIONS', path: '/hello', agent: false }, resolve).end(),
    );
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['access-control-allow-private-network']).toBe('true');
  });
});
