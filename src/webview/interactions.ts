// Mouse interactions: stroking, poking, buttons (bowl, treat, toy, rope), belly rub, calling,
// context menu. Only our own elements ever call preventDefault, and we never take the focus.
import { triggers } from '../shared/triggers';
import type { ObjectKey } from '../shared/types';
import type { Facing, Step } from './engine';
import type { Pet } from './main';

const FRAME = 24;
const TOOLBAR_HIDE_MS = 2000;
const PHYSICS_DT = 100; // 10 Hz
const GRAVITY = 0.7;
const BOUNCE_Y = 0.45;
const BOUNCE_X = 0.75;
const FRICTION = 0.8;
const STOP_SPEED = 0.3;

interface Sample {
  t: number;
  x: number;
  y: number;
}

interface Toy {
  el: HTMLCanvasElement;
  w: number;
  h: number;
  /** World position of the toy's bottom centre (atlas px, y=0 is the box edge). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: 'held' | 'flying' | 'resting' | 'carried';
  acc: number;
  startX: number;
}

export class Interactions {
  private toolbar: HTMLDivElement;
  private toolbarLeftAt = 0;
  private overPet = false;
  private overToolbar = false;
  private lastMove = 0;
  private lastMoveAt = 0;
  private lastPos: Sample | null = null;
  private lastDir = 0;
  private dirChanges: number[] = [];
  private turns: { t: number; a: number }[] = [];
  private lastVec: { x: number; y: number } | null = null;
  private stroking = false;
  private bellyRubbing = false;
  private down: { t: number; x: number; y: number } | null = null;
  private menu: HTMLDivElement | null = null;
  private menuCloser: ((e: Event) => void) | null = null;
  private toy: Toy | null = null;
  private bowl: HTMLCanvasElement | null = null;
  private rope: { icon: HTMLCanvasElement | null; line: HTMLCanvasElement | null; tugging: boolean; x: number; y: number } | null = null;
  private samples: Sample[] = [];
  private disposers: (() => void)[] = [];

  constructor(private readonly pet: Pet) {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'cp-toolbar';
    this.toolbar.setAttribute('role', 'toolbar');
    this.pet.mount.root.appendChild(this.toolbar);
    this.buildToolbar();
    this.bind();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.closeMenu();
    this.endRope();
    this.removeToy();
    this.removeBowl();
  }

  private on<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    const wrapped = (e: HTMLElementEventMap[K]) => {
      try {
        fn(e);
      } catch (err) {
        this.pet.log('Interaktion fehlgeschlagen', err);
      }
    };
    el.addEventListener(type, wrapped as EventListener, opts);
    this.disposers.push(() => el.removeEventListener(type, wrapped as EventListener, opts));
  }

  private get now(): number {
    return performance.now();
  }

  // ----- wiring ------------------------------------------------------------------

  private bind(): void {
    const hit = this.pet.hit;
    this.on(hit, 'pointerenter', () => {
      this.overPet = true;
      this.showToolbar();
    });
    this.on(hit, 'pointerleave', () => {
      this.overPet = false;
      this.lastPos = null;
      this.lastVec = null;
      this.scheduleToolbarHide();
      this.setTransparent(false);
    });
    this.on(hit, 'pointermove', (e) => this.onHover(e));
    this.on(hit, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // our element: keep the focus in the prompt
      this.down = { t: this.now, x: e.clientX, y: e.clientY };
    });
    this.on(hit, 'pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || e.button !== 0) return;
      if (this.now - d.t < 400 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) this.poke();
    });
    this.on(hit, 'contextmenu', (e) => {
      e.preventDefault();
      this.openMenu(e.clientX, e.clientY);
    });
    this.on(hit, 'mousedown', (e) => e.preventDefault());

    this.on(this.toolbar, 'pointerenter', () => {
      this.overToolbar = true;
      this.showToolbar();
    });
    this.on(this.toolbar, 'pointerleave', () => {
      this.overToolbar = false;
      this.scheduleToolbarHide();
    });

    const strip = this.pet.mount.callStrip;
    this.on(strip, 'dblclick', (e) => {
      e.preventDefault();
      this.call(e.clientX);
    });
    this.on(strip, 'mousedown', (e) => e.preventDefault());
  }

  onSpeciesChanged(): void {
    this.closeMenu();
    this.endRope();
    this.removeToy();
    this.removeBowl();
    this.buildToolbar();
  }

  onConfigChanged(): void {
    this.buildToolbar();
    if (!this.pet.cfg.showButtons) this.toolbar.classList.remove('cp-visible');
  }

  // ----- toolbar ---------------------------------------------------------------------

  private buildToolbar(): void {
    this.toolbar.textContent = '';
    const sp = this.pet.assets.atlas.species;
    const buttons: { key: ObjectKey; title: string; down: (e: PointerEvent, b: HTMLButtonElement) => void }[] = [
      { key: 'bowl_full', title: `Napf füllen`, down: () => this.feed() },
      { key: 'treat', title: `Leckerli zuwerfen (${sp.item})`, down: () => this.treat() },
      { key: 'toy', title: `${sp.toy} werfen – ziehen und loslassen`, down: (e, b) => this.grabToy(e, b) },
      { key: 'rope_icon', title: `${sp.rope} – festhalten und zum Maul ziehen`, down: (e, b) => this.grabRope(e, b) },
    ];
    for (const def of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'cp-btn';
      b.title = def.title;
      b.setAttribute('aria-label', def.title);
      const icon = this.pet.objectCanvas(def.key, this.pet.scale >= 3 ? 1 : 1.5);
      if (icon) b.appendChild(icon);
      this.on(b, 'pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        def.down(e, b);
      });
      this.on(b, 'mousedown', (e) => e.preventDefault());
      this.toolbar.appendChild(b);
    }
  }

  private showToolbar(): void {
    if (!this.pet.cfg.showButtons || this.pet.occluded) return;
    this.toolbar.classList.add('cp-visible');
  }

  private scheduleToolbarHide(): void {
    this.toolbarLeftAt = this.now;
  }

  /** Hide the bar 2 s after the pointer left pet and bar (not while a toy/rope is in hand). */
  private maybeHideToolbar(now: number): void {
    if (!this.toolbar.classList.contains('cp-visible')) return;
    if (this.overPet || this.overToolbar || this.toy?.state === 'held' || this.rope) {
      this.toolbarLeftAt = now;
      return;
    }
    if (now - this.toolbarLeftAt > TOOLBAR_HIDE_MS) this.toolbar.classList.remove('cp-visible');
  }

  private positionToolbar(): void {
    if (!this.toolbar.classList.contains('cp-visible')) return;
    const s = this.pet.scale;
    const width = this.toolbar.offsetWidth || 100;
    const rootW = this.pet.mount.edge?.width ?? 0;
    const box = this.pet.assets.animBox(this.pet.engine.currentClip?.id ?? 'sitzen');
    const topRow = box ? box.y0 : 4;
    let left = this.pet.engine.x * s + (FRAME * s) / 2 - width / 2;
    left = Math.max(0, Math.min(left, rootW - width));
    this.toolbar.style.left = `${Math.round(left)}px`;
    this.toolbar.style.top = `${Math.round(-(FRAME - 1 - topRow) * s - this.toolbar.offsetHeight - 4)}px`;
  }

  // ----- hover: stroke, belly rub, transparency -------------------------------------------

  private resting(): boolean {
    const pose = this.pet.engine.pose;
    return pose === 'lie' || pose === 'belly' || this.pet.behavior.phase !== 'sitting';
  }

  private onHover(e: PointerEvent): void {
    const t = this.now;
    this.lastMoveAt = t;
    this.setTransparent(false);
    const p = this.lastPos;
    this.lastPos = { t, x: e.clientX, y: e.clientY };
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) < 1.5) return;
    this.lastMove = t;

    // Turning angle of the movement path (for circles over the lying pet).
    const v = { x: dx, y: dy };
    if (this.lastVec) {
      const cross = this.lastVec.x * v.y - this.lastVec.y * v.x;
      const dot = this.lastVec.x * v.x + this.lastVec.y * v.y;
      this.turns.push({ t, a: Math.atan2(cross, dot) });
    }
    this.lastVec = v;
    this.turns = this.turns.filter((x) => t - x.t < 1500);

    // Horizontal direction changes (for stroking).
    if (Math.abs(dx) >= 1) {
      const dir = Math.sign(dx);
      if (this.lastDir !== 0 && dir !== this.lastDir) this.dirChanges.push(t);
      this.lastDir = dir;
    }
    this.dirChanges = this.dirChanges.filter((x) => t - x < 1000);

    if (this.bellyRubbing || this.stroking) return;
    if (this.resting()) {
      const sum = this.turns.reduce((acc, x) => acc + x.a, 0);
      if (Math.abs(sum) >= Math.PI * 2) this.bellyRub();
      return;
    }
    if (this.dirChanges.length >= 3) this.stroke();
  }

  private setTransparent(on: boolean): void {
    this.pet.petEl.style.opacity = on ? String(this.pet.cfg.opacityOnHover) : '';
  }

  private promptFocused(): boolean {
    const a = document.activeElement;
    const input = this.pet.mount.promptInput();
    return !!a && !!input && (a === input || input.contains(a));
  }

  private stroke(): void {
    const rule = triggers.interactions.hoverMove as { while?: string } | undefined;
    this.stroking = true;
    this.dirChanges = [];
    const ok = this.pet.behavior.interact('pet:stroke', [
      { clip: rule?.while ?? 'streicheln', mode: 'loop', until: () => this.now - this.lastMove > 450 },
    ], {
      onEnd: () => {
        this.stroking = false;
      },
    });
    if (!ok) this.stroking = false;
  }

  private bellyRub(): void {
    const rule = triggers.interactions.circleOverLying as { play?: string[]; while?: string; end?: string[] } | undefined;
    const b = this.pet.behavior;
    const steps: Step[] = [];
    if (b.phase === 'sleeping') steps.push({ clip: 'aufwachen' });
    for (const c of rule?.play ?? ['auf_den_ruecken_rollen']) steps.push({ clip: c });
    steps.push({ clip: rule?.while ?? 'bauch_kraulen', mode: 'loop', until: () => this.now - this.lastMove > 700 });
    for (const c of rule?.end ?? ['auf_den_ruecken_rollen:reverse']) steps.push({ clip: c });
    this.bellyRubbing = true;
    this.turns = [];
    b.phase = 'lying';
    b.lastActivity = this.now;
    const ok = this.pet.engine.request({
      name: 'pet:belly',
      kind: 'interaction',
      priority: triggers.priorities.interaction,
      steps,
      onEnd: () => {
        this.bellyRubbing = false;
        b.phase = 'lying';
        b.lastActivity = this.now;
      },
    });
    if (!ok) this.bellyRubbing = false;
  }

  private poke(): void {
    const rule = triggers.interactions.click as { play?: string[] } | undefined;
    const steps = this.pet.behavior.playSteps(rule?.play ?? ['erschrecken:2-3', 'freuen']);
    this.pet.behavior.interact('pet:click', steps);
  }

  private call(clientX: number): void {
    const w = this.pet.toWorld(clientX, 0);
    const target = Math.round(w.x - FRAME / 2);
    this.pet.behavior.walkTo(target, triggers.priorities.interaction, 'interaction', 'pet:call', this.pet.behavior.activity());
  }

  // ----- bowl & treat --------------------------------------------------------------------

  private placeObject(el: HTMLElement, wx: number, wy: number): void {
    const s = this.pet.scale;
    el.style.left = `${Math.round(wx * s)}px`;
    el.style.top = `${Math.round(wy * s)}px`;
  }

  private removeBowl(): void {
    this.bowl?.remove();
    this.bowl = null;
  }

  private feed(): void {
    const rule = triggers.interactions.feedButton as { fresstDauerMs?: number } | undefined;
    const r = this.pet.assets.objectRect('bowl_full');
    if (!r) return;
    const { min, max } = this.pet.bounds();
    const width = (this.pet.mount.edge?.width ?? 0) / this.pet.scale;
    const x = this.pet.engine.x;
    // fressen shows its bowl at sprite x 17–23: facing right the pet stands at bowlX − 17,
    // facing left (mirrored) at bowlX.
    let facing: Facing = 1;
    let petX = Math.min(Math.max(x + 13, min), max);
    let bowlX = petX + 17;
    if (bowlX + r.w > width) {
      facing = -1;
      petX = Math.min(Math.max(x - 13, min), max);
      bowlX = petX;
    }
    this.removeBowl();
    const bowl = this.pet.objectCanvas('bowl_full');
    if (!bowl) return;
    this.bowl = bowl;
    this.pet.mount.root.appendChild(bowl);
    this.placeObject(bowl, bowlX, -r.h);
    const showEmpty = () => {
      const empty = this.pet.objectCanvas('bowl_empty');
      this.removeBowl();
      if (!empty) return;
      this.bowl = empty;
      this.pet.mount.root.appendChild(empty);
      this.placeObject(empty, bowlX, -(this.pet.assets.objectRect('bowl_empty')?.h ?? r.h));
      window.setTimeout(() => {
        if (this.bowl === empty) this.removeBowl();
      }, 2000);
    };
    let ate = false;
    this.pet.behavior.interact(
      'pet:feed',
      [
        { clip: 'umdrehen' },
        { clip: 'gehen', mode: 'loop', moveTo: petX },
        {
          clip: 'fressen',
          mode: 'loop',
          durationMs: rule?.fresstDauerMs ?? 4000,
          face: facing,
          onStart: () => {
            if (this.bowl) this.bowl.style.visibility = 'hidden';
          },
          onEnd: () => {
            ate = true;
            showEmpty();
          },
        },
      ],
      {
        onEnd: (reason) => {
          if (reason === 'interrupted' && !ate) this.removeBowl();
        },
      },
    );
  }

  private treat(): void {
    const rule = triggers.interactions.treatButton as { sequence?: string[] } | undefined;
    this.pet.behavior.interact('pet:treat', this.pet.behavior.playSteps(rule?.sequence ?? ['leckerli_fangen']));
  }

  // ----- toy -------------------------------------------------------------------------------

  private removeToy(): void {
    this.toy?.el.remove();
    this.toy = null;
  }

  private drawToy(): void {
    const t = this.toy;
    if (!t) return;
    this.placeObject(t.el, t.x - t.w / 2, t.y - t.h);
  }

  private grabToy(e: PointerEvent, button: HTMLButtonElement): void {
    const r = this.pet.assets.objectRect('toy');
    const el = this.pet.objectCanvas('toy');
    if (!r || !el) return;
    this.removeToy();
    this.pet.mount.root.appendChild(el);
    const w = this.pet.toWorld(e.clientX, e.clientY);
    this.toy = { el, w: r.w, h: r.h, x: w.x, y: Math.min(w.y, 0), vx: 0, vy: 0, state: 'held', acc: 0, startX: this.pet.engine.x };
    this.drawToy();
    this.samples = [{ t: this.now, x: e.clientX, y: e.clientY }];
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const toyFacing = (): Facing | null => {
      const t = this.toy;
      if (!t) return null;
      return t.x >= this.pet.engine.x + FRAME / 2 ? 1 : -1;
    };
    this.pet.behavior.interact('pet:toy', [{ clip: 'umdrehen' }, { clip: 'ball_lauern', mode: 'loop', face: toyFacing }], {
      onEnd: (reason) => {
        if (reason === 'interrupted' && this.toy?.state === 'held') this.removeToy();
      },
    });
    const move = (ev: PointerEvent) => {
      if (!this.toy || this.toy.state !== 'held') return;
      const p = this.pet.toWorld(ev.clientX, ev.clientY);
      this.toy.x = p.x;
      this.toy.y = Math.min(p.y + this.toy.h / 2, 0);
      this.samples.push({ t: this.now, x: ev.clientX, y: ev.clientY });
      this.samples = this.samples.filter((s) => this.now - s.t <= 100);
      this.drawToy();
    };
    const up = () => {
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', up);
      this.throwToy();
    };
    button.addEventListener('pointermove', move);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
  }

  private throwToy(): void {
    const t = this.toy;
    if (!t || t.state !== 'held') return;
    const s = this.pet.scale;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = first && last ? Math.max(16, last.t - first.t) : 100;
    // CSS px per ms → atlas px per physics tick (100 ms).
    let vx = first && last ? ((last.x - first.x) / dt) * (PHYSICS_DT / s) : 0;
    let vy = first && last ? ((last.y - first.y) / dt) * (PHYSICS_DT / s) : 0;
    const max = 18;
    const mag = Math.hypot(vx, vy);
    if (mag > max) {
      vx = (vx / mag) * max;
      vy = (vy / mag) * max;
    }
    t.vx = vx;
    t.vy = vy;
    t.state = t.y >= 0 && Math.abs(vx) < STOP_SPEED && Math.abs(vy) < STOP_SPEED ? 'resting' : 'flying';
    t.startX = this.pet.engine.x;
    this.chase();
  }

  /** Where the pet stands so that its mouth is at the toy (never past it). */
  private chaseTarget(): number | null {
    const t = this.toy;
    if (!t) return null;
    const x = this.pet.engine.x;
    return t.x >= x + FRAME / 2 ? t.x - (FRAME - 1) : t.x;
  }

  private chase(): void {
    const t = this.toy;
    if (!t) return;
    const n = this.pet.assets.anims.ball_fangen?.frames.length ?? 12;
    const pickup = `ball_fangen:${Math.max(1, n - 3)}-${n}`;
    const startX = t.startX;
    const steps: Step[] = [
      {
        clip: 'rennen',
        mode: 'loop',
        moveTo: () => this.chaseTarget(),
        until: () => {
          const toy = this.toy;
          if (!toy) return true;
          const target = this.chaseTarget();
          return toy.state === 'resting' && target !== null && Math.abs(target - this.pet.engine.x) < 1;
        },
      },
      {
        clip: pickup,
        onEnd: () => {
          if (this.toy) {
            this.toy.state = 'carried';
            this.toy.el.style.visibility = 'hidden';
          }
        },
      },
      { clip: 'mit_ball_gehen', mode: 'loop', moveTo: startX },
      { clip: 'umdrehen:reverse' },
      {
        clip: 'mit_ball_sitzen',
        mode: 'loop',
        durationMs: 4000,
        onEnd: () => this.dropToy(),
      },
    ];
    this.pet.behavior.interact('pet:fetch', steps, {
      onEnd: (reason) => {
        if (reason === 'interrupted') this.removeToy();
      },
    });
  }

  /** Put the toy down in front of the pet and let it fade out. */
  private dropToy(): void {
    const t = this.toy;
    if (!t) return;
    t.state = 'resting';
    t.vx = 0;
    t.vy = 0;
    t.x = this.pet.engine.x + FRAME / 2 + 6;
    t.y = 0;
    t.el.style.visibility = '';
    this.drawToy();
    t.el.classList.add('cp-fade');
    const el = t.el;
    window.setTimeout(() => {
      if (this.toy?.el === el) this.removeToy();
    }, 900);
  }

  private stepToy(): void {
    const t = this.toy;
    if (!t || t.state !== 'flying') return;
    const width = (this.pet.mount.edge?.width ?? 0) / this.pet.scale;
    t.vy += GRAVITY;
    t.x += t.vx;
    t.y += t.vy;
    if (t.y >= 0) {
      t.y = 0;
      if (Math.abs(t.vy) > 1) {
        t.vy = -t.vy * BOUNCE_Y;
        t.vx *= BOUNCE_X;
      } else {
        t.vy = 0;
      }
    }
    if (t.y === 0 && t.vy === 0) {
      t.vx *= FRICTION;
      if (Math.abs(t.vx) < STOP_SPEED) {
        t.vx = 0;
        t.state = 'resting';
      }
    }
    const minX = t.w / 2;
    const maxX = Math.max(minX, width - t.w / 2);
    if (t.x < minX) {
      t.x = minX;
      t.vx = Math.abs(t.vx) * BOUNCE_X;
    } else if (t.x > maxX) {
      t.x = maxX;
      t.vx = -Math.abs(t.vx) * BOUNCE_X;
    }
  }

  // ----- rope ------------------------------------------------------------------------------

  private grabRope(e: PointerEvent, button: HTMLButtonElement): void {
    this.endRope();
    const icon = this.pet.objectCanvas('rope_icon', 1.5);
    if (icon) {
      icon.classList.add('cp-cursor-obj');
      icon.setAttribute('data-claude-pets', '');
      document.body.appendChild(icon);
    }
    this.rope = { icon, line: null, tugging: false, x: e.clientX, y: e.clientY };
    this.moveRope(e.clientX, e.clientY);
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const facing = (): Facing | null => {
      const r = this.rope;
      if (!r) return null;
      const c = this.pet.toClient(this.pet.engine.x + FRAME / 2, 0);
      return r.x >= c.x ? 1 : -1;
    };
    this.pet.behavior.interact('pet:rope', [{ clip: 'umdrehen' }, { clip: 'stehen', mode: 'loop', face: facing }], {
      onEnd: (reason) => {
        if (reason === 'interrupted' && this.rope && !this.rope.tugging) this.endRope();
      },
    });
    const move = (ev: PointerEvent) => this.moveRope(ev.clientX, ev.clientY);
    const up = () => {
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', up);
      this.endRope();
      this.pet.engine.release('pet:rope');
      this.pet.engine.release('pet:tug');
    };
    button.addEventListener('pointermove', move);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
  }

  private moveRope(x: number, y: number): void {
    const r = this.rope;
    if (!r) return;
    r.x = x;
    r.y = y;
    if (r.icon) {
      r.icon.style.left = `${Math.round(x - r.icon.offsetWidth / 2)}px`;
      r.icon.style.top = `${Math.round(y - r.icon.offsetHeight / 2)}px`;
    }
    if (!r.tugging) {
      const m = this.pet.mouth();
      const mc = this.pet.toClient(m.x, m.y);
      if (Math.hypot(mc.x - x, mc.y - y) < 10 * this.pet.scale) this.startTug();
    }
  }

  private startTug(): void {
    const r = this.rope;
    if (!r) return;
    r.tugging = true;
    r.icon?.remove();
    r.icon = null;
    const line = document.createElement('canvas');
    line.className = 'cp-rope-line';
    line.setAttribute('data-claude-pets', '');
    document.body.appendChild(line);
    r.line = line;
    const facing = (): Facing | null => {
      const rr = this.rope;
      if (!rr) return null;
      const c = this.pet.toClient(this.pet.engine.x + FRAME / 2, 0);
      return rr.x >= c.x ? 1 : -1;
    };
    const rule = triggers.interactions.ropeButton as { while?: string } | undefined;
    this.pet.behavior.interact('pet:tug', [{ clip: rule?.while ?? 'zerrspiel', mode: 'loop', face: facing }], {
      onEnd: () => this.endRope(),
    });
  }

  private endRope(): void {
    const r = this.rope;
    if (!r) return;
    this.rope = null;
    r.icon?.remove();
    r.line?.remove();
  }

  private drawRope(): void {
    const r = this.rope;
    if (!r || !r.line) return;
    const s = this.pet.scale;
    const w = Math.ceil(window.innerWidth / s);
    const h = Math.ceil(window.innerHeight / s);
    const c = r.line;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const m = this.pet.mouth();
    const mc = this.pet.toClient(m.x, m.y);
    let x0 = Math.floor(mc.x / s);
    let y0 = Math.floor(mc.y / s);
    const x1 = Math.floor(r.x / s);
    const y1 = Math.floor(r.y / s);
    const colors = this.pet.assets.ropeColors;
    // Bresenham, alternating the two rope colours every two pixels.
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let i = 0;
    for (let guard = 0; guard < 4000; guard++) {
      ctx.fillStyle = colors[Math.floor(i / 2) % colors.length];
      ctx.fillRect(x0, y0, 1, 1);
      i++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  // ----- context menu -------------------------------------------------------------------

  private openMenu(x: number, y: number): void {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'cp-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('data-claude-pets', '');
    this.toolbar.classList.remove('cp-visible');
    const entries = triggers.interactions.contextMenu;
    for (const [label, value] of Object.entries(entries)) {
      if (value === 'openSpeciesPicker') {
        const item = this.menuItem(menu, label, () => undefined, true);
        const sub = this.speciesSubmenu();
        item.appendChild(sub);
        const open = () => {
          sub.classList.add('cp-open');
          const ir = item.getBoundingClientRect();
          const sr = sub.getBoundingClientRect();
          sub.classList.toggle('cp-left', ir.right + sr.width > window.innerWidth - 4);
          if (ir.top + sr.height > window.innerHeight - 4) sub.style.top = `${Math.round(window.innerHeight - 4 - sr.height - ir.top)}px`;
        };
        item.addEventListener('pointerenter', open);
        item.addEventListener('click', open);
        item.addEventListener('pointerleave', () => sub.classList.remove('cp-open'));
        continue;
      }
      if (Array.isArray(value)) this.menuItem(menu, label, () => this.menuCommand(label, value));
    }
    const sep = document.createElement('div');
    sep.className = 'cp-menu-sep';
    menu.appendChild(sep);
    this.menuItem(menu, 'Ausblenden (bis Neuladen)', () => this.pet.hideUntilReload());

    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.round(Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.round(Math.max(4, Math.min(y, window.innerHeight - r.height - 4)))}px`;
    this.menu = menu;
    const closer = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && menu.contains(e.target as Node)) return;
      this.closeMenu();
    };
    this.menuCloser = closer;
    document.addEventListener('pointerdown', closer, { capture: true, passive: true });
    document.addEventListener('keydown', closer, { capture: true, passive: true });
    window.addEventListener('blur', closer);
  }

  private closeMenu(): void {
    if (this.menuCloser) {
      document.removeEventListener('pointerdown', this.menuCloser, { capture: true });
      document.removeEventListener('keydown', this.menuCloser, { capture: true });
      window.removeEventListener('blur', this.menuCloser);
    }
    this.menuCloser = null;
    this.menu?.remove();
    this.menu = null;
  }

  private menuItem(parent: HTMLElement, label: string, run: () => void, submenu = false): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'cp-menu-item' + (submenu ? ' cp-has-sub' : '');
    item.setAttribute('role', 'menuitem');
    const text = document.createElement('span');
    text.textContent = label;
    item.appendChild(text);
    item.addEventListener('pointerdown', (e) => e.preventDefault());
    item.addEventListener('mousedown', (e) => e.preventDefault());
    if (!submenu) {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMenu();
        try {
          run();
        } catch (err) {
          this.pet.log('Menübefehl fehlgeschlagen', err);
        }
      });
    }
    parent.appendChild(item);
    return item;
  }

  private speciesSubmenu(): HTMLDivElement {
    const sub = document.createElement('div');
    sub.className = 'cp-menu cp-submenu';
    sub.setAttribute('role', 'menu');
    for (const id of this.pet.lib.ids()) {
      const item = this.menuItem(sub, this.pet.lib.label(id), () => void this.pet.setSpecies(id, true));
      if (id === this.pet.speciesId) item.classList.add('cp-checked');
    }
    return sub;
  }

  private menuCommand(label: string, specs: string[]): void {
    const base = triggers.idle.base || 'sitzen';
    const last = specs[specs.length - 1];
    const b = this.pet.behavior;
    if (last === 'liegen') return b.restCommand(`menu:${label}`, specs, 'lying');
    if (last === 'schlafen') return b.restCommand(`menu:${label}`, specs, 'sleeping');
    const steps = b.playSteps(specs.filter((s) => s !== base));
    b.interact(`menu:${label}`, steps);
  }

  // ----- per frame ------------------------------------------------------------------------

  update(dt: number, now: number): void {
    const t = this.toy;
    if (t && t.state === 'flying') {
      t.acc += dt;
      while (t.acc >= PHYSICS_DT && t.state === 'flying') {
        t.acc -= PHYSICS_DT;
        this.stepToy();
      }
      this.drawToy();
    }
    if (this.rope?.tugging) this.drawRope();
    this.maybeHideToolbar(now);
    this.positionToolbar();
    // Transparency: resting mouse over the pet while the prompt has focus.
    if (this.overPet && now - this.lastMoveAt > 600 && this.promptFocused()) this.setTransparent(true);
  }
}
