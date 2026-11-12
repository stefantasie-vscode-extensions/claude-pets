// Local HTTP/SSE bridge between the hook script and the injected webview script.
//   POST /event          hook payload in → sanitized PetEvent out to all SSE clients
//   GET  /events?token=  Server-Sent Events for the webview script
//   GET  /hello?token=   { ok, workspaceFolders, version }
//   POST /species?token= species picked in the webview's context menu
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sanitizeHookPayload } from './shared/events';
import { BRIDGE_PORT_FIRST, BRIDGE_PORT_LAST, type PetConfig, type PetEvent } from './shared/types';

const MAX_BODY = 1024 * 1024;
const KEEPALIVE_MS = 20000;

export interface BridgeOptions {
  token: string;
  version: string;
  workspaceFolders: () => string[];
  onSpecies?: (species: string, persist: boolean) => void;
  onEvent?: (event: PetEvent) => void;
  log?: (msg: string) => void;
  host?: string;
  portFirst?: number;
  portLast?: number;
}

interface Client {
  id: number;
  res: http.ServerResponse;
}

export class Bridge {
  private server: http.Server | null = null;
  private clients = new Map<number, Client>();
  private nextId = 1;
  private keepalive: NodeJS.Timeout | null = null;
  private lastConfig: PetConfig | null = null;
  port: number | null = null;
  eventCount = 0;
  lastEventAt: number | null = null;

  constructor(private readonly opts: BridgeOptions) {}

  get clientCount(): number {
    return this.clients.size;
  }

  /** Bind the first free port in the configured range. Resolves to the port or null. */
  async start(): Promise<number | null> {
    const first = this.opts.portFirst ?? BRIDGE_PORT_FIRST;
    const last = this.opts.portLast ?? BRIDGE_PORT_LAST;
    for (let port = first; port <= last; port++) {
      const server = http.createServer((req, res) => this.handle(req, res));
      const ok = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, this.opts.host ?? '127.0.0.1', () => resolve(true));
      });
      if (ok) {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        server.on('error', (e) => this.opts.log?.(`Bridge-Fehler: ${e.message}`));
        this.keepalive = setInterval(() => this.writeAll(': keepalive\n\n'), KEEPALIVE_MS);
        return this.port;
      }
      server.close();
    }
    return null;
  }

  async stop(): Promise<void> {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    for (const c of this.clients.values()) {
      try {
        c.res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    const server = this.server;
    this.server = null;
    this.port = null;
    if (server) {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
    }
  }

  broadcast(event: PetEvent): void {
    this.writeAll(`event: hook\ndata: ${JSON.stringify(event)}\n\n`);
  }

  pushConfig(config: PetConfig): void {
    this.lastConfig = config;
    this.writeAll(`event: config\ndata: ${JSON.stringify(config)}\n\n`);
  }

  private writeAll(chunk: string): void {
    for (const c of this.clients.values()) {
      try {
        c.res.write(chunk);
      } catch {
        this.clients.delete(c.id);
      }
    }
  }

  private tokenOk(req: http.IncomingMessage, url: URL): boolean {
    const given = (req.headers['x-claude-pets-token'] as string | undefined) ?? url.searchParams.get('token') ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(this.opts.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  private hostOk(req: http.IncomingMessage): boolean {
    // Guards against DNS rebinding: only literal loopback host names are accepted.
    const host = (req.headers.host ?? '').toLowerCase();
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
  }

  private cors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-claude-pets-token');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Vary', 'Origin');
  }

  private send(res: http.ServerResponse, status: number, body?: unknown): void {
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
  }

  private readBody(req: http.IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      this.cors(res);
      if (!this.hostOk(req)) return this.send(res, 403, { ok: false });
      if (req.method === 'OPTIONS') return this.send(res, 204);
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
      if (!this.tokenOk(req, url)) return this.send(res, 403, { ok: false });

      if (req.method === 'GET' && url.pathname === '/hello') {
        return this.send(res, 200, {
          ok: true,
          workspaceFolders: this.opts.workspaceFolders(),
          version: this.opts.version,
          pid: process.pid,
        });
      }

      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const id = this.nextId++;
        this.clients.set(id, { id, res });
        res.write('retry: 3000\n\n');
        res.write(`event: hello\ndata: ${JSON.stringify({ version: this.opts.version, pid: process.pid })}\n\n`);
        if (this.lastConfig) res.write(`event: config\ndata: ${JSON.stringify(this.lastConfig)}\n\n`);
        const drop = () => this.clients.delete(id);
        req.on('close', drop);
        res.on('close', drop);
        res.on('error', drop);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/event') {
        const body = await this.readBody(req);
        if (body === null) return this.send(res, 413, { ok: false });
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return this.send(res, 400, { ok: false });
        }
        const event = sanitizeHookPayload(payload);
        if (!event) return this.send(res, 400, { ok: false });
        this.eventCount++;
        this.lastEventAt = Date.now();
        this.broadcast(event);
        this.opts.onEvent?.(event);
        return this.send(res, 204);
      }

      if (req.method === 'POST' && url.pathname === '/species') {
        const body = await this.readBody(req);
        let species = '';
        let persist = true;
        try {
          const parsed = JSON.parse(body ?? '{}') as { species?: unknown; persist?: unknown };
          species = typeof parsed.species === 'string' ? parsed.species : '';
          persist = parsed.persist !== false;
        } catch {
          species = (body ?? '').trim();
        }
        if (!/^[a-z]{2,20}$/.test(species)) return this.send(res, 400, { ok: false });
        this.opts.onSpecies?.(species, persist);
        return this.send(res, 204);
      }

      return this.send(res, 404, { ok: false });
    } catch (err) {
      this.opts.log?.(`Bridge-Anfrage fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      try {
        this.send(res, 500, { ok: false });
      } catch {
        /* response already gone */
      }
    }
  }
}
