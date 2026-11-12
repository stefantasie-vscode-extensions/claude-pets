// Webview side of the bridge: find the local bridge(s), subscribe via EventSource, reconnect.
import type { PetConfig, PetEvent } from '../shared/types';

export interface BridgeHandlers {
  event(ev: PetEvent): void;
  config(cfg: PetConfig): void;
  status?(connectedPorts: number[]): void;
}

const HELLO_TIMEOUT_MS = 800;
const MAX_BACKOFF_MS = 30000;
const RESCAN_CONNECTED_MS = 60000;
const DEDUPE_MS = 250;

export class BridgeClient {
  private sources = new Map<number, EventSource>();
  private backoff = 1000;
  private timer: number | null = null;
  private stopped = false;
  private recent: { key: string; at: number }[] = [];

  constructor(
    private readonly ports: number[],
    private token: string,
    private readonly h: BridgeHandlers,
    private readonly log: (...a: unknown[]) => void = () => {},
  ) {}

  get connectedPorts(): number[] {
    return [...this.sources.keys()];
  }

  start(): void {
    this.stopped = false;
    void this.scan();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    for (const es of this.sources.values()) es.close();
    this.sources.clear();
  }

  private url(port: number, path: string): string {
    return `http://127.0.0.1:${port}${path}?token=${encodeURIComponent(this.token)}`;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.scan(), ms);
  }

  private async hello(port: number): Promise<boolean> {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), HELLO_TIMEOUT_MS);
    try {
      const res = await fetch(this.url(port, '/hello'), { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(t);
    }
  }

  /**
   * Probe all ports. The webview cannot know which VS Code window it lives in, so it
   * subscribes to every reachable bridge; events are matched to this pet by session id later.
   */
  private async scan(): Promise<void> {
    if (this.stopped) return;
    // Bridges take the first free port from the bottom of the range, so windows occupy a
    // contiguous block. Probing upwards and stopping after two misses keeps the number of
    // (unavoidable, logged) connection errors in the webview console small.
    let misses = 0;
    for (const port of this.ports) {
      if (this.stopped) return;
      if (this.sources.has(port)) {
        misses = 0;
        continue;
      }
      if (await this.hello(port)) {
        this.connect(port);
        misses = 0;
      } else if (++misses >= 2) {
        break;
      }
    }
    this.h.status?.(this.connectedPorts);
    if (this.sources.size > 0) {
      this.backoff = 1000;
      this.schedule(RESCAN_CONNECTED_MS);
    } else {
      this.schedule(this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    }
  }

  private connect(port: number): void {
    if (this.sources.has(port) || this.stopped) return;
    const es = new EventSource(this.url(port, '/events'));
    this.sources.set(port, es);
    es.addEventListener('hook', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent<string>).data) as PetEvent;
        if (!this.duplicate(ev)) this.h.event(ev);
      } catch (err) {
        this.log('Ungültiges Ereignis', err);
      }
    });
    es.addEventListener('config', (e) => {
      try {
        this.h.config(JSON.parse((e as MessageEvent<string>).data) as PetConfig);
      } catch (err) {
        this.log('Ungültige Konfiguration', err);
      }
    });
    es.onerror = () => {
      // Closed window or restarted extension host: drop it and look again with backoff.
      es.close();
      this.sources.delete(port);
      this.h.status?.(this.connectedPorts);
      this.schedule(this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }

  /** The hook script may deliver one event to several windows; drop the copies. */
  private duplicate(ev: PetEvent): boolean {
    const now = performance.now();
    const key = `${ev.event}|${ev.sid ?? ''}|${ev.tool ?? ''}|${ev.tag ?? ''}|${ev.outcome ?? ''}|${ev.notification ?? ''}`;
    this.recent = this.recent.filter((r) => now - r.at < DEDUPE_MS);
    if (this.recent.some((r) => r.key === key)) return true;
    this.recent.push({ key, at: now });
    return false;
  }

  /** Report the species chosen in the context menu (persist=false: only for the status bar). */
  async postSpecies(species: string, persist: boolean): Promise<void> {
    const body = JSON.stringify({ species, persist });
    await Promise.all(
      this.connectedPorts.map((port) =>
        // text/plain keeps this a "simple" CORS request (no preflight).
        fetch(this.url(port, '/species'), { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined),
      ),
    );
  }
}
