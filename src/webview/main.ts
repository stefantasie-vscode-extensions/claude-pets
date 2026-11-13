// Entry point of the script injected into Claude Code's webview (bundled as an IIFE).
import embedded from 'claude-pets:assets';
import { hashId } from '../shared/events';
import { triggers } from '../shared/triggers';
import type { EmbeddedSpecies, ObjectKey, PetConfig } from '../shared/types';
import { AssetLibrary, type SpeciesAssets } from './atlas';
import { Behavior } from './behavior';
import { BridgeClient } from './bridgeClient';
import { DomSignals } from './domSignals';
import { Engine } from './engine';
import { Interactions } from './interactions';
import { Mount } from './mount';
import { ROOT_WITH_SESSION } from './selectors';

declare const __CLAUDE_PETS_CONFIG__: PetConfig | undefined;

const FRAME = 24;
const STORAGE_KEY = 'claude-pets.species';

const DEFAULT_CONFIG: PetConfig = {
  version: '0.0.0',
  species: 'dog',
  scale: 2,
  showButtons: true,
  wander: true,
  sleepAfterMs: 240000,
  opacityOnHover: 0.35,
  reduceMotion: 'auto',
  debug: false,
  bridge: { enabled: false, ports: [], token: '' },
};

export class Pet {
  cfg: PetConfig;
  readonly lib: AssetLibrary;
  assets!: SpeciesAssets;
  engine!: Engine;
  behavior!: Behavior;
  mount!: Mount;
  signals!: DomSignals;
  bridge: BridgeClient | null = null;
  ui!: Interactions;
  readonly petEl: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly hit: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private raf: number | null = null;
  private last = 0;
  private drawnKey = '';
  private blinkAt = 0;
  private blinkStart = -1;
  private hiddenUntilReload = false;
  private reducedMq: MediaQueryList | null = null;
  private occludedCheckAt = 0;
  private placed = false;
  occluded = false;
  speciesId = 'dog';

  constructor(cfg: PetConfig, all: EmbeddedSpecies[]) {
    this.cfg = cfg;
    this.lib = new AssetLibrary(all);
    this.petEl = document.createElement('div');
    this.petEl.className = 'cp-pet';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cp-sprite';
    this.canvas.width = FRAME;
    this.canvas.height = FRAME;
    this.ctx = this.canvas.getContext('2d')!;
    this.hit = document.createElement('div');
    this.hit.className = 'cp-hit';
    this.petEl.append(this.canvas, this.hit);
  }

  get scale(): number {
    return Math.min(4, Math.max(1, Math.round(this.cfg.scale || 2)));
  }

  log = (...args: unknown[]): void => {
    if (this.cfg.debug) console.debug('[claude-pets]', ...args);
  };

  async start(): Promise<void> {
    this.speciesId = this.initialSpecies();
    this.assets = await this.lib.load(this.speciesId);
    this.mount = new Mount(document);
    this.mount.root.appendChild(this.petEl);

    this.engine = new Engine({
      anims: this.assets.anims,
      gait: this.assets.gait,
      bounds: () => this.bounds(),
      base: () => this.behavior.baseAction(),
      isAirborne: (f) => this.assets.isAirborne(f),
    });
    this.behavior = new Behavior({
      triggers,
      engine: () => this.engine,
      now: () => performance.now(),
      bounds: () => this.bounds(),
      log: this.log,
    });
    this.behavior.loopFlags = loopFlags(this.assets);
    this.applySettings();

    const root = document.querySelector(ROOT_WITH_SESSION);
    const sid = root?.getAttribute('data-initial-session');
    if (sid) this.behavior.bindInitialSession(hashId(sid));

    this.signals = new DomSignals({
      typing: () => this.behavior.onTyping(),
      escape: () => this.behavior.onEscape(),
      submit: () => this.behavior.onLocalSubmit(),
      busy: (on) => this.behavior.setBusy(on),
      permission: (v) => this.behavior.setPermissionDialog(v),
    });
    this.signals.start();

    this.ui = new Interactions(this);

    if (this.cfg.bridge.enabled && this.cfg.bridge.token && this.cfg.bridge.ports.length > 0) {
      this.bridge = new BridgeClient(
        this.cfg.bridge.ports,
        this.cfg.bridge.token,
        {
          event: (ev) => {
            this.log('hook', ev);
            this.behavior.onHook(ev);
          },
          config: (c) => void this.applyConfig(c),
          status: (ports) => this.log('bridge', ports),
        },
        this.log,
      );
      this.bridge.start();
      void this.bridge.postSpecies(this.speciesId, false);
    }

    document.addEventListener('visibilitychange', this.onVisibility);
    // Debug handle for the webview DevTools ("Developer: Open Webview Developer Tools").
    if (this.cfg.debug) (window as unknown as { __claudePets?: Pet }).__claudePets = this;
    this.resume();
  }

  private initialSpecies(): string {
    const ids = this.lib.ids();
    if (isRandom(this.cfg.species)) return ids[Math.floor(Math.random() * ids.length)] ?? 'dog';
    let id = this.cfg.species;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { species?: string; basedOn?: string } | null;
      // Only honour the menu choice while the setting has not changed since.
      if (saved && saved.basedOn === this.cfg.species && saved.species && this.lib.has(saved.species)) id = saved.species;
    } catch {
      /* storage unavailable */
    }
    return this.lib.has(id) ? id : 'dog';
  }

  /** Switch species. `fromMenu` remembers the choice and reports it to the extension. */
  async setSpecies(id: string, fromMenu: boolean): Promise<void> {
    if (!this.lib.has(id)) return;
    if (fromMenu) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ species: id, basedOn: this.cfg.species }));
      } catch {
        /* storage unavailable */
      }
      void this.bridge?.postSpecies(id, true);
    }
    if (id === this.speciesId) return;
    const assets = await this.lib.load(id);
    this.speciesId = id;
    this.assets = assets;
    this.behavior.loopFlags = loopFlags(assets);
    this.behavior.phase = 'sitting';
    this.engine.setAnims(assets.anims, assets.gait);
    this.drawnKey = '';
    this.ui.onSpeciesChanged();
  }

  /** New settings pushed live over the bridge. */
  async applyConfig(next: PetConfig): Promise<void> {
    const prev = this.cfg;
    this.cfg = { ...next, bridge: prev.bridge };
    this.applySettings();
    if (next.species !== prev.species) {
      const id = isRandom(next.species) ? this.lib.ids()[Math.floor(Math.random() * this.lib.ids().length)] : next.species;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      await this.setSpecies(id, false);
      void this.bridge?.postSpecies(this.speciesId, false);
    }
    this.drawnKey = '';
    this.ui?.onConfigChanged();
  }

  private applySettings(): void {
    if (!this.reducedMq && typeof matchMedia === 'function') {
      this.reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMq.addEventListener?.('change', () => this.applySettings());
    }
    const reduce = this.cfg.reduceMotion === 'on' || (this.cfg.reduceMotion === 'auto' && !!this.reducedMq?.matches);
    this.behavior.settings = {
      wander: this.cfg.wander,
      sleepAfterMs: Math.max(60000, this.cfg.sleepAfterMs || 240000),
      reduceMotion: reduce,
    };
    const s = this.scale;
    this.petEl.style.width = `${FRAME * s}px`;
    this.petEl.style.height = `${FRAME * s}px`;
    this.petEl.style.top = `${-(FRAME - 1) * s}px`;
    this.mount?.root.style.setProperty('--cp-scale', String(s));
  }

  /** Walkable x range in atlas pixels. */
  bounds(): { min: number; max: number } {
    const w = this.mount?.edge?.width ?? 0;
    return { min: 0, max: Math.max(0, Math.floor(w / this.scale) - FRAME) };
  }

  /** Viewport coordinates of a world point (atlas px; x from the box's left, y from its top edge). */
  toClient(wx: number, wy: number): { x: number; y: number } {
    const e = this.mount.edge ?? { left: 0, top: 0, width: 0 };
    return { x: e.left + wx * this.scale, y: e.top + wy * this.scale };
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const e = this.mount.edge ?? { left: 0, top: 0, width: 0 };
    return { x: (clientX - e.left) / this.scale, y: (clientY - e.top) / this.scale };
  }

  /** Mouth point in world coordinates (sprite x 23, row 13; mirrored when facing left). */
  mouth(): { x: number; y: number } {
    const f = this.engine.frame();
    const flipped = f?.flip ?? false;
    return { x: this.engine.x + (flipped ? 0 : 23) + 0.5, y: 13 - (FRAME - 1) + 0.5 };
  }

  /** Bounding box of the visible sprite in viewport coordinates. */
  spriteRect(): DOMRect {
    return this.hit.getBoundingClientRect();
  }

  hideUntilReload(): void {
    this.hiddenUntilReload = true;
    this.pause();
    this.signals.stop();
    this.bridge?.stop();
    this.ui.dispose();
    this.mount.dispose();
  }

  private onVisibility = (): void => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  private pause(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private resume(): void {
    if (this.hiddenUntilReload || this.raf !== null) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    this.raf = null;
    if (this.hiddenUntilReload || document.hidden) return;
    try {
      const dt = Math.min(250, Math.max(0, t - this.last));
      this.last = t;
      const mounted = this.mount.update(t);
      if (mounted && !this.placed) {
        // First measurement: start on the right side of the box, away from the text start.
        this.placed = true;
        this.engine.x = Math.round(this.bounds().max * 0.75);
      }
      if (mounted) {
        this.behavior.update(dt);
        this.engine.tick(dt);
        this.ui.update(dt, t);
        this.render(t);
      }
    } catch (err) {
      this.log('Animation step failed', err);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private blinkState(now: number): 'open' | 'half' | 'closed' {
    const cfg = triggers.idle.blink;
    if (this.blinkAt === 0) this.blinkAt = now + cfg.everyMs[0] + Math.random() * (cfg.everyMs[1] - cfg.everyMs[0]);
    if (this.blinkStart < 0 && now >= this.blinkAt) this.blinkStart = now;
    if (this.blinkStart < 0) return 'open';
    const i = Math.floor((now - this.blinkStart) / cfg.frameMs);
    if (i >= cfg.sequence.length) {
      this.blinkStart = -1;
      this.blinkAt = now + cfg.everyMs[0] + Math.random() * (cfg.everyMs[1] - cfg.everyMs[0]);
      return 'open';
    }
    return cfg.sequence[i] === 'closed' ? 'closed' : 'half';
  }

  private render(now: number): void {
    const f = this.engine.frame();
    if (!f) return;
    let frame = f.frame;
    const eyes = this.assets.eyes.get(frame);
    if (eyes && triggers.idle.blink.appliesTo.includes(f.anim)) {
      const b = this.blinkState(now);
      if (b === 'half') frame = eyes.half;
      else if (b === 'closed') frame = eyes.closed;
    }
    const s = this.scale;
    this.petEl.style.left = `${Math.round(f.x * s)}px`;
    const key = `${this.speciesId}|${frame}|${f.flip}`;
    if (key !== this.drawnKey) {
      const r = this.assets.frameRect(frame);
      if (r) {
        this.ctx.clearRect(0, 0, FRAME, FRAME);
        this.ctx.drawImage(this.assets.sheet, r.x, r.y, r.w, r.h, 0, 0, FRAME, FRAME);
      }
      this.canvas.style.transform = f.flip ? 'scaleX(-1)' : '';
      this.updateHitBox(f.anim, f.flip);
      this.drawnKey = key;
    }
    if (now - this.occludedCheckAt > 200) {
      this.occludedCheckAt = now;
      const occluded = this.mount.isOccluded(this.spriteRect());
      if (occluded !== this.occluded) {
        this.occluded = occluded;
        this.mount.root.classList.toggle('cp-occluded', occluded);
      }
    }
  }

  /** Clickable area = opaque bounds of the current animation, never below the box edge. */
  private updateHitBox(anim: string, flip: boolean): void {
    const b = this.assets.animBox(anim);
    const s = this.scale;
    const x0 = b ? (flip ? FRAME - 1 - b.x1 : b.x0) : 2;
    const x1 = b ? (flip ? FRAME - 1 - b.x0 : b.x1) : FRAME - 3;
    const y0 = b ? b.y0 : 2;
    const y1 = Math.min(b ? b.y1 : FRAME - 2, FRAME - 2);
    this.hit.style.left = `${x0 * s}px`;
    this.hit.style.top = `${y0 * s}px`;
    this.hit.style.width = `${(x1 - x0 + 1) * s}px`;
    this.hit.style.height = `${(y1 - y0 + 1) * s}px`;
  }

  /** Small canvas showing one object from objects.png at the pet's scale. */
  objectCanvas(key: ObjectKey, extraScale = 1): HTMLCanvasElement | null {
    const r = this.assets.objectRect(key);
    if (!r) return null;
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    c.className = 'cp-obj';
    c.style.width = `${r.w * this.scale * extraScale}px`;
    c.style.height = `${r.h * this.scale * extraScale}px`;
    c.getContext('2d')?.drawImage(this.assets.objects, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return c;
  }
}

/** "random" (and the pre-0.2.0 value "zufall") pick a different pet on every start. */
function isRandom(species: string): boolean {
  return species === 'random' || species === 'zufall';
}

function loopFlags(a: SpeciesAssets): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, anim] of Object.entries(a.anims)) out[id] = !!anim.loop;
  return out;
}

function boot(): void {
  const w = window as unknown as { __claudePetsActive?: boolean };
  if (w.__claudePetsActive) return;
  w.__claudePetsActive = true;
  const cfg: PetConfig =
    typeof __CLAUDE_PETS_CONFIG__ !== 'undefined' && __CLAUDE_PETS_CONFIG__
      ? { ...DEFAULT_CONFIG, ...__CLAUDE_PETS_CONFIG__ }
      : DEFAULT_CONFIG;
  const pet = new Pet(cfg, embedded as EmbeddedSpecies[]);
  const go = () =>
    pet.start().catch((err: unknown) => {
      console.warn('[claude-pets]', err);
    });
  if (document.body) go();
  else document.addEventListener('DOMContentLoaded', go, { once: true });
}

boot();
