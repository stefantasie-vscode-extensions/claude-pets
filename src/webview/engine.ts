// Animation engine: time based frame stepping, priorities, pose graph, movement.
// Pure TypeScript (no DOM) so it can be unit tested with a fake clock.
import type { AnimDef, Pose } from '../shared/types';

// ---------------------------------------------------------------------------
// Clip references ("name", "name:reverse", "name:2-3")

export interface ClipRef {
  id: string;
  reverse: boolean;
  /** 1-based, inclusive */
  from?: number;
  to?: number;
}

export function parseClipRef(spec: string): ClipRef {
  const [id, ...mods] = spec.split(':');
  const ref: ClipRef = { id, reverse: false };
  for (const mod of mods) {
    if (mod === 'reverse') ref.reverse = true;
    else {
      const m = /^(\d+)(?:-(\d+))?$/.exec(mod);
      if (m) {
        ref.from = Number(m[1]);
        ref.to = Number(m[2] ?? m[1]);
      }
    }
  }
  return ref;
}

export interface ResolvedClip {
  spec: string;
  id: string;
  frames: string[];
  fps: number;
  startPose: Pose;
  endPose: Pose;
  /** Whether the atlas marks the animation as a loop. */
  animLoop: boolean;
}

export function resolveClip(anims: Record<string, AnimDef>, spec: string): ResolvedClip | null {
  const ref = parseClipRef(spec);
  const anim = anims[ref.id];
  if (!anim || anim.frames.length === 0) return null;
  const n = anim.frames.length;
  const from = Math.min(Math.max(ref.from ?? 1, 1), n);
  const to = Math.min(Math.max(ref.to ?? n, from), n);
  let frames = anim.frames.slice(from - 1, to);
  let [p0, p1] = anim.pose;
  if (p0 !== p1 && (from > 1 || to < n)) {
    // Partial clip of a pose-changing animation: pick the pose of the half it covers.
    const mid = n / 2;
    const s = from - 1 < mid ? p0 : p1;
    const e = to > mid ? p1 : p0;
    p0 = s;
    p1 = e;
  }
  if (ref.reverse) {
    frames = [...frames].reverse();
    [p0, p1] = [p1, p0];
  }
  return { spec, id: ref.id, frames, fps: anim.fps > 0 ? anim.fps : 8, startPose: p0, endPose: p1, animLoop: anim.loop };
}

export function poseAt(clip: ResolvedClip, index: number): Pose {
  if (clip.startPose === clip.endPose) return clip.startPose;
  return index < clip.frames.length / 2 ? clip.startPose : clip.endPose;
}

// ---------------------------------------------------------------------------
// Pose graph

export const TRANSITION_IDS = ['umdrehen', 'hinlegen', 'auf_den_ruecken_rollen'];

export type PoseGraph = Map<Pose, { to: Pose; clip: string }[]>;

/** Edges come from the atlas (the crab, for example, rolls from "sit" straight to "belly"). */
export function buildPoseGraph(anims: Record<string, AnimDef>, ids: string[] = TRANSITION_IDS): PoseGraph {
  const graph: PoseGraph = new Map();
  const add = (from: Pose, to: Pose, clip: string) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from)!.push({ to, clip });
  };
  for (const id of ids) {
    const a = anims[id];
    if (!a || a.pose[0] === a.pose[1]) continue;
    add(a.pose[0], a.pose[1], id);
    add(a.pose[1], a.pose[0], `${id}:reverse`);
  }
  return graph;
}

/** Shortest list of transition clips from one pose to another (breadth-first search). */
export function findTransition(graph: PoseGraph, from: Pose, to: Pose): string[] | null {
  if (from === to) return [];
  const prev = new Map<Pose, { pose: Pose; clip: string }>();
  const queue: Pose[] = [from];
  const seen = new Set<Pose>([from]);
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const edge of graph.get(p) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      prev.set(edge.to, { pose: p, clip: edge.clip });
      if (edge.to === to) {
        const path: string[] = [];
        let cur: Pose = to;
        while (cur !== from) {
          const step = prev.get(cur)!;
          path.unshift(step.clip);
          cur = step.pose;
        }
        return path;
      }
      queue.push(edge.to);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Steps and actions

export type Facing = 1 | -1;

export interface Step {
  clip: string;
  /** once = a single pass (default); loop = repeat until duration/until/target or forever. */
  mode?: 'once' | 'loop';
  durationMs?: number;
  until?: () => boolean;
  /** Walk to this x (atlas px). A function is re-evaluated every frame; null = stand still. */
  moveTo?: number | (() => number | null);
  /** Movement in atlas px per frame; defaults by animation id (see DEFAULT_SPEEDS). */
  speed?: number;
  /** Force the facing while this step plays. */
  face?: Facing | (() => Facing | null);
  onStart?: () => void;
  onEnd?: () => void;
  /** Inserted automatically by the pose graph. */
  transition?: boolean;
}

export type ActionKind = 'hook' | 'dom' | 'interaction' | 'idle';

export interface Action {
  name: string;
  kind: ActionKind;
  priority: number;
  steps: Step[];
  /** Follow-up state after the steps (a looping step); absent = back to the base action. */
  then?: { steps: Step[]; priority: number } | null;
  /** Hook events allowed to end this action's looping state (others need a higher priority). */
  until?: string[];
  onEnd?: (reason: 'done' | 'interrupted') => void;
}

export const DEFAULT_SPEEDS: Record<string, number> = {
  gehen: 1,
  mit_ball_gehen: 1,
  knochen_bringen: 1,
  rennen: 3,
  schnueffeln: 0.5,
};

export interface EngineOptions {
  anims: Record<string, AnimDef>;
  gait: 'walk' | 'hop';
  bounds: () => { min: number; max: number };
  /** The resting action when nothing else plays (provided by the behaviour layer). */
  base: () => Action;
  isAirborne?: (frame: string) => boolean;
  speeds?: Record<string, number>;
}

export interface FrameState {
  frame: string;
  anim: string;
  index: number;
  pose: Pose;
  flip: boolean;
  x: number;
  facing: Facing;
}

interface Playing {
  step: Step;
  clip: ResolvedClip;
  idx: number;
  acc: number;
  elapsed: number;
  moving: boolean;
  hasAirborne: boolean;
  arrived: boolean;
}

export class Engine {
  x = 0;
  facing: Facing = 1;
  pose: Pose = 'sit';
  private anims: Record<string, AnimDef>;
  private gait: 'walk' | 'hop';
  private graph: PoseGraph;
  private action: Action | null = null;
  private onBase = false;
  private phase: 'steps' | 'then' = 'steps';
  private queue: Step[] = [];
  private cur: Playing | null = null;
  private pendingAction: Action | null = null;

  constructor(private readonly opts: EngineOptions) {
    this.anims = opts.anims;
    this.gait = opts.gait;
    this.graph = buildPoseGraph(opts.anims);
  }

  /** Swap the species (animations) and restart from the base action. */
  setAnims(anims: Record<string, AnimDef>, gait: 'walk' | 'hop'): void {
    this.anims = anims;
    this.gait = gait;
    this.graph = buildPoseGraph(anims);
    this.pendingAction = null;
    const old = this.action;
    this.action = null;
    this.cur = null;
    if (old && !this.onBase) old.onEnd?.('interrupted');
    this.pose = 'sit';
    this.startBase();
  }

  get current(): Action | null {
    return this.action;
  }

  get pending(): Action | null {
    return this.pendingAction;
  }

  get currentClip(): ResolvedClip | null {
    return this.cur?.clip ?? null;
  }

  get currentStep(): Step | null {
    return this.cur?.step ?? null;
  }

  isBase(): boolean {
    return this.onBase || this.action === null;
  }

  /** True while the current action sits in an endless loop (a "state" rather than a one-shot). */
  inState(): boolean {
    if (this.isBase()) return true;
    if (this.phase === 'then') return true;
    const s = this.cur?.step;
    return !!s && this.queue.length === 0 && isEndless(s);
  }

  effectivePriority(): number {
    if (this.isBase()) return this.action?.priority ?? 0;
    if (this.phase === 'then' && this.action?.then) return this.action.then.priority;
    return this.action?.priority ?? 0;
  }

  /**
   * Ask for an action. Rules (triggers.json "priorities"):
   * - higher priority interrupts immediately;
   * - a looping state is replaced by an equal priority, and any hook state by the next hook
   *   event (unless its "until" list says otherwise);
   * - one-shots finish first; hooks (and equal priorities) are queued, newest wins.
   */
  request(action: Action): boolean {
    if (this.isBase()) {
      this.start(action);
      return true;
    }
    const cur = this.action!;
    const eff = this.effectivePriority();
    if (action.priority > eff) {
      this.start(action);
      return true;
    }
    if (this.inState()) {
      if (action.kind === 'hook' && cur.kind === 'hook') {
        if (cur.until && this.phase === 'steps' && !cur.until.includes(action.name)) return false;
        this.start(action);
        return true;
      }
      if (action.priority === eff) {
        this.start(action);
        return true;
      }
      return false;
    }
    if (action.kind === 'hook' || action.priority === eff) {
      const p = this.pendingAction;
      if (!p || action.priority >= p.priority || (p.kind === 'hook' && action.kind === 'hook' && !p.until)) {
        this.pendingAction = action;
        return true;
      }
    }
    return false;
  }

  /** End a looping action by name (e.g. typing stopped). */
  release(name: string): void {
    if (this.pendingAction?.name === name) this.pendingAction = null;
    if (this.action?.name === name && !this.onBase && this.inState()) this.finish('done');
  }

  /** Drop whatever plays and return to the base action. */
  interrupt(): void {
    this.pendingAction = null;
    if (!this.onBase && this.action) this.finish('interrupted');
  }

  /** Restart the base action (e.g. after the behaviour layer changed the idle phase). */
  refreshBase(): void {
    if (this.onBase) this.startBase();
  }

  private start(action: Action): void {
    const prev = this.action;
    const prevWasBase = this.onBase;
    const seamless = this.canContinueSeamlessly(action);
    const keep = this.cur;
    this.action = action;
    this.onBase = false;
    this.phase = 'steps';
    this.queue = [...action.steps];
    this.cur = null;
    if (prev && !prevWasBase && prev !== action) prev.onEnd?.('interrupted');
    if (seamless && keep) {
      // Same endless loop as before (e.g. "nachdenken" from a hook and from the DOM):
      // keep the running frame instead of restarting the clip.
      const step = this.queue.shift()!;
      this.cur = { ...keep, step, elapsed: 0 };
      step.onStart?.();
      return;
    }
    this.advance();
  }

  private canContinueSeamlessly(action: Action): boolean {
    const s = this.cur?.step;
    const first = action.steps[0];
    return !!s && !!first && action.steps.length === 1 && isEndless(s) && isEndless(first) && s.clip === first.clip && !first.moveTo;
  }

  private startBase(): void {
    const base = this.opts.base();
    this.action = base;
    this.onBase = true;
    this.phase = 'steps';
    this.queue = [...base.steps];
    this.cur = null;
    this.advance();
  }

  private finish(reason: 'done' | 'interrupted'): void {
    const a = this.action;
    this.cur = null;
    this.queue = [];
    if (a && !this.onBase) a.onEnd?.(reason);
    if (this.pendingAction) {
      const next = this.pendingAction;
      this.pendingAction = null;
      this.action = null;
      this.onBase = false;
      this.start(next);
      return;
    }
    this.startBase();
  }

  /** Move on to the next step (inserting pose transitions as needed). */
  private advance(): void {
    let baseRestarts = 0;
    for (;;) {
      const step = this.queue.shift();
      if (!step) {
        if (this.onBase) {
          // Base actions end in an endless loop; if they ran out anyway, restart them once.
          if (baseRestarts++ > 0) return;
          this.queue = [...(this.action?.steps ?? [])];
          if (this.queue.length === 0) return;
          continue;
        }
        if (this.phase === 'steps' && this.pendingAction) {
          this.finish('done');
          return;
        }
        if (this.phase === 'steps' && this.action?.then && this.action.then.steps.length > 0) {
          this.phase = 'then';
          this.queue = [...this.action.then.steps];
          continue;
        }
        this.finish('done');
        return;
      }
      const clip = resolveClip(this.anims, step.clip);
      if (!clip) continue;
      const isTransitionClip = TRANSITION_IDS.includes(clip.id);
      if (isTransitionClip && !step.transition && clip.startPose !== clip.endPose && clip.startPose !== this.pose) {
        // An explicit transition from a pose we are not in: let the pose graph take over.
        continue;
      }
      if (clip.startPose !== this.pose) {
        const path = findTransition(this.graph, this.pose, clip.startPose);
        if (path && path.length > 0) {
          this.queue.unshift(...path.map((c) => ({ clip: c, transition: true })), step);
          continue;
        }
      }
      if (!this.onBase && this.pendingAction && isEndless(step) && this.queue.length === 0) {
        // The one-shot part is over and a state would begin: the queued action wins.
        this.finish('done');
        return;
      }
      this.begin(step, clip);
      return;
    }
  }

  private begin(step: Step, clip: ResolvedClip): void {
    const speed = step.speed ?? (this.opts.speeds ?? DEFAULT_SPEEDS)[clip.id] ?? 0;
    const isAir = this.opts.isAirborne;
    this.cur = {
      step,
      clip,
      idx: 0,
      acc: 0,
      elapsed: 0,
      moving: speed > 0,
      hasAirborne: !!isAir && clip.frames.some((f) => isAir(f)),
      arrived: false,
    };
    this.applyFacing(step);
    this.pose = poseAt(clip, 0);
    step.onStart?.();
  }

  private applyFacing(step: Step): void {
    const f = typeof step.face === 'function' ? step.face() : step.face;
    if (f) {
      this.facing = f;
      return;
    }
    if (step.moveTo !== undefined) {
      const t = typeof step.moveTo === 'function' ? step.moveTo() : step.moveTo;
      if (t !== null && Math.abs(t - this.x) >= 0.5) this.facing = t > this.x ? 1 : -1;
    }
  }

  /** Advance time. */
  tick(dtMs: number): void {
    if (!this.cur) {
      if (!this.action) this.startBase();
      else this.advance();
      if (!this.cur) return;
    }
    const dt = Math.max(0, Math.min(dtMs, 1000));
    const playing = this.cur;
    playing.acc += dt;
    playing.elapsed += dt;
    let guard = 0;
    while (this.cur && this.cur === playing && playing.acc >= 1000 / playing.clip.fps && guard++ < 32) {
      playing.acc -= 1000 / playing.clip.fps;
      this.nextFrame(playing);
    }
    // Time-based end conditions are also checked between frames.
    if (this.cur === playing && this.loopShouldEnd(playing)) this.endStep(playing);
    this.clampX();
  }

  private loopShouldEnd(p: Playing): boolean {
    const s = p.step;
    if (s.mode !== 'loop') return false;
    if (s.durationMs !== undefined && p.elapsed >= s.durationMs) return true;
    if (s.until && s.until()) return true;
    if (s.moveTo !== undefined && p.arrived && !s.until && s.durationMs === undefined) return true;
    return false;
  }

  private nextFrame(p: Playing): void {
    const s = p.step;
    const last = p.idx >= p.clip.frames.length - 1;
    if (last) {
      if (s.mode === 'loop' && !this.loopShouldEnd(p)) {
        p.idx = 0;
      } else {
        this.endStep(p);
        return;
      }
    } else {
      p.idx++;
    }
    this.pose = poseAt(p.clip, p.idx);
    this.applyFacingLive(s);
    if (p.moving) this.move(p);
    if (this.loopShouldEnd(p)) this.endStep(p);
  }

  private applyFacingLive(step: Step): void {
    if (typeof step.face === 'function') {
      const f = step.face();
      if (f) this.facing = f;
    }
  }

  private move(p: Playing): void {
    const s = p.step;
    let speed = s.speed ?? (this.opts.speeds ?? DEFAULT_SPEEDS)[p.clip.id] ?? 0;
    if (this.gait === 'hop' && p.hasAirborne) {
      const frame = p.clip.frames[p.idx];
      speed = this.opts.isAirborne!(frame) ? speed * 2 : 0;
    }
    if (speed <= 0) return;
    const { min, max } = this.opts.bounds();
    if (s.moveTo !== undefined) {
      const raw = typeof s.moveTo === 'function' ? s.moveTo() : s.moveTo;
      if (raw === null) return;
      const target = Math.min(Math.max(raw, min), Math.max(min, max));
      const d = target - this.x;
      if (Math.abs(d) <= speed) {
        this.x = target;
        p.arrived = true;
      } else {
        p.arrived = false;
        if (typeof s.face !== 'function' && s.face === undefined) this.facing = d > 0 ? 1 : -1;
        this.x += Math.sign(d) * speed;
      }
      return;
    }
    // Free roaming: walk in the facing direction and turn around at the edges.
    this.x += this.facing * speed;
    if (this.x <= min) {
      this.x = min;
      this.facing = 1;
    } else if (this.x >= max) {
      this.x = Math.max(min, max);
      this.facing = -1;
    }
  }

  private endStep(p: Playing): void {
    if (this.cur !== p) return;
    this.pose = p.clip.endPose;
    if (p.idx < p.clip.frames.length - 1 && p.clip.startPose !== p.clip.endPose) this.pose = poseAt(p.clip, p.idx);
    this.cur = null;
    p.step.onEnd?.();
    if (this.cur === null) this.advance();
  }

  private clampX(): void {
    const { min, max } = this.opts.bounds();
    if (this.x < min) this.x = min;
    if (this.x > Math.max(min, max)) this.x = Math.max(min, max);
  }

  frame(): FrameState | null {
    const p = this.cur;
    if (!p) return null;
    const pose = poseAt(p.clip, p.idx);
    return {
      frame: p.clip.frames[p.idx],
      anim: p.clip.id,
      index: p.idx,
      pose,
      flip: this.facing === -1 && pose !== 'sit',
      x: this.x,
      facing: this.facing,
    };
  }
}

export function isEndless(step: Step): boolean {
  return step.mode === 'loop' && step.durationMs === undefined && !step.until && step.moveTo === undefined;
}
