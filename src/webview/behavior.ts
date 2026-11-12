// triggers.json → actions; idle life (wander, random actions, lie down, sleep, wake up).
// No DOM access: everything external comes in through the constructor.
import { bashWhileForTag, priorityOf, toolRule, type PlayRule, type Triggers } from '../shared/triggers';
import type { BashTag, PetEvent } from '../shared/types';
import type { Action, ActionKind, Engine, Step } from './engine';

/** A resolved reaction, independent of the engine (unit-testable). */
export interface Plan {
  name: string;
  priority: number;
  play: string[];
  while?: string;
  then?: string;
  until?: string[];
  action?: string;
  durationMs?: number;
}

/** Loop animations used in a "play" list get this much time instead of a single pass. */
export const PLAY_DURATIONS: Record<string, number> = {
  knochen_bringen: 1500, // triggers.json note: "1,5 s laufen lassen, dabei Position bewegen"
};

function fromRule(name: string, rule: PlayRule | undefined, t: Triggers): Plan | null {
  if (!rule) return null;
  return {
    name,
    priority: priorityOf(rule.priority, t),
    play: [...(rule.play ?? [])],
    while: rule.while,
    then: rule.then,
    until: rule.until,
    action: rule.action,
    durationMs: rule.duration_ms,
  };
}

/** Map a hook event to a plan (null = nothing to do). */
export function planForHook(ev: PetEvent, t: Triggers, rememberedTag?: BashTag): Plan | null {
  const rule = t.hooks[ev.event] as (PlayRule & Record<string, unknown>) | undefined;
  if (!rule) return null;

  if (ev.event === 'PreToolUse') {
    const tr = toolRule(ev.tool, t);
    if (!tr) return null;
    const plan = fromRule(ev.event, tr, t)!;
    if (ev.tool === 'Bash') {
      const tag = ev.tag ?? 'bash';
      plan.while = bashWhileForTag(tag, t) ?? tr.while ?? 'rennen';
      plan.priority = priorityOf(tr.priority, t);
    }
    return plan;
  }

  if (ev.event === 'PostToolUse') {
    const byTag = (rule._byTag ?? {}) as Record<string, { success?: string[]; failure?: string[] }>;
    const tag = ev.tag ?? rememberedTag;
    const table = tag ? byTag[tag] : undefined;
    let play: string[] = [];
    if (table && ev.outcome === 'success') play = table.success ?? [];
    if (table && ev.outcome === 'failure') play = table.failure ?? [];
    return { name: ev.event, priority: priorityOf(rule.priority, t), play: [...play], then: rule.then };
  }

  if (ev.event === 'Notification') {
    const byMatcher = (rule._byMatcher ?? {}) as Record<string, PlayRule>;
    const r = (ev.notification && byMatcher[ev.notification]) || byMatcher['*'];
    return fromRule(ev.event, r, t);
  }

  return fromRule(ev.event, rule, t);
}

// ---------------------------------------------------------------------------

export type IdlePhase = 'sitting' | 'lying' | 'sleeping';

export interface BehaviorOptions {
  triggers: Triggers;
  engine: () => Engine;
  now: () => number;
  random?: () => number;
  /** Walkable range in atlas px. */
  bounds: () => { min: number; max: number };
  log?: (...args: unknown[]) => void;
}

export interface BehaviorSettings {
  wander: boolean;
  sleepAfterMs: number;
  reduceMotion: boolean;
}

const WHILE_TIMEOUT_MS = 60000;
const SUBMIT_BIND_WINDOW_MS = 4000;

export class Behavior {
  phase: IdlePhase = 'sitting';
  lastActivity: number;
  private lastHookAt = 0;
  private lastTag: BashTag | undefined;
  private typingUntil = 0;
  private busy = false;
  private permission = false;
  private lastLocalSubmit = -Infinity;
  boundSid: string | null = null;
  settings: BehaviorSettings = { wander: true, sleepAfterMs: 240000, reduceMotion: false };
  private readonly t: Triggers;
  private readonly rnd: () => number;

  constructor(private readonly o: BehaviorOptions) {
    this.t = o.triggers;
    this.rnd = o.random ?? Math.random;
    this.lastActivity = o.now();
  }

  private get engine(): Engine {
    return this.o.engine();
  }

  private P(name: string): number {
    return priorityOf(name, this.t);
  }

  // ----- building blocks ----------------------------------------------------

  /** Which animation ids are loops in the atlas (set by the pet when the species loads). */
  loopFlags: Record<string, boolean> | null = null;

  /**
   * Steps for a list of clip specs. Looping animations in a one-shot list play a single pass,
   * unless a duration applies (PLAY_DURATIONS or the rule's duration_ms).
   */
  playSteps(specs: string[], defaultDurationMs?: number): Step[] {
    const loops = this.loopFlags ?? {};
    return specs.map((spec) => {
      const id = spec.split(':')[0];
      const duration = loops[id] ? (PLAY_DURATIONS[id] ?? defaultDurationMs) : undefined;
      return duration !== undefined ? { clip: spec, mode: 'loop', durationMs: duration } : { clip: spec };
    });
  }

  baseAction(): Action {
    const id = this.phase === 'sleeping' ? 'schlafen' : this.phase === 'lying' ? 'liegen' : this.t.idle.base || 'sitzen';
    return { name: `idle:${this.phase}`, kind: 'idle', priority: this.P('idle'), steps: [{ clip: id, mode: 'loop' }] };
  }

  /** Wake-up clips if the pet rests; switches the phase back to sitting. */
  private wakeSteps(): Step[] {
    if (this.phase === 'sitting') return [];
    const seq = [...this.t.idle.wakeUp];
    // "aufwachen" only makes sense when it actually slept.
    if (this.phase !== 'sleeping' && seq[0] === 'aufwachen') seq.shift();
    this.phase = 'sitting';
    return this.playSteps(seq);
  }

  /** Record activity (resets the lie-down / sleep timers). Returns wake-up steps if needed. */
  activity(): Step[] {
    this.lastActivity = this.o.now();
    return this.wakeSteps();
  }

  planToAction(plan: Plan, kind: ActionKind, prefix: Step[] = []): Action {
    const steps: Step[] = [...prefix, ...this.playSteps(plan.play, plan.durationMs)];
    if (plan.while) steps.push({ clip: plan.while, mode: 'loop' });
    let then: Action['then'] = null;
    let onEnd: Action['onEnd'];
    if (!plan.while && plan.then && plan.then !== 'idle') {
      if (plan.then === 'liegen' || plan.then === 'schlafen') {
        const phase: IdlePhase = plan.then === 'liegen' ? 'lying' : 'sleeping';
        onEnd = (reason) => {
          if (reason === 'done') {
            this.phase = phase;
            // Count the rest as started now, so lie-down/sleep timers continue from here.
            this.lastActivity = this.o.now();
          }
        };
      } else {
        then = { steps: [{ clip: plan.then, mode: 'loop' }], priority: Math.min(plan.priority, this.P('thinking')) };
      }
    }
    return { name: plan.name, kind, priority: plan.priority, steps, then, until: plan.until, onEnd };
  }

  // ----- hooks ---------------------------------------------------------------

  onHook(ev: PetEvent): void {
    const now = this.o.now();
    // A UserPromptSubmit right after a prompt was sent from *this* webview binds the pet to
    // that session; the reaction already played when the prompt was sent.
    if (ev.event === 'UserPromptSubmit' && now - this.lastLocalSubmit < SUBMIT_BIND_WINDOW_MS) {
      if (ev.sid) this.boundSid = ev.sid;
      this.lastLocalSubmit = -Infinity;
      this.lastHookAt = now;
      return;
    }
    if (this.boundSid && ev.sid && ev.sid !== this.boundSid) return; // another session
    if (ev.event === 'SessionEnd' && ev.sid && ev.sid === this.boundSid) this.boundSid = null;

    this.lastHookAt = now;
    if (ev.event === 'PreToolUse' && ev.tool === 'Bash') this.lastTag = ev.tag;
    const plan = planForHook(ev, this.t, this.lastTag);
    if (ev.event === 'PostToolUse' || ev.event === 'PostToolUseFailure') this.lastTag = undefined;
    const wake = this.activity();
    if (!plan) {
      if (wake.length > 0) this.engine.request({ name: 'wake', kind: 'idle', priority: this.P('ambient'), steps: wake });
      return;
    }
    if (plan.action === 'walkToRandomSpot') {
      this.walkTo(this.randomSpot(), plan.priority, 'hook', ev.event, wake);
      return;
    }
    this.engine.request(this.planToAction(plan, 'hook', wake));
  }

  bindInitialSession(sid: string | null): void {
    if (sid && !this.boundSid) this.boundSid = sid;
  }

  // ----- DOM signals ---------------------------------------------------------

  onTyping(): void {
    const rule = this.t.dom.typing;
    const now = this.o.now();
    this.typingUntil = now + (rule?.stopAfterMs ?? 1500);
    const wake = this.activity();
    const cur = this.engine.current;
    if (cur?.name === 'dom:typing' && wake.length === 0) return;
    this.engine.request({
      name: 'dom:typing',
      kind: 'dom',
      priority: priorityOf(rule?.priority ?? 'reading', this.t),
      steps: [...wake, { clip: rule?.while ?? 'zuschauen', mode: 'loop' }],
    });
  }

  onEscape(): void {
    if (!this.busy) return;
    const rule = this.t.dom.escapeInterrupt;
    const plan = fromRule('dom:escape', rule, this.t);
    if (plan) this.engine.request(this.planToAction(plan, 'dom', this.activity()));
  }

  /** The user sent a prompt from this webview (Enter / send button). */
  onLocalSubmit(): void {
    this.lastLocalSubmit = this.o.now();
    const plan = planForHook({ event: 'UserPromptSubmit', ts: this.o.now() }, this.t);
    if (plan) this.engine.request(this.planToAction({ ...plan, name: 'UserPromptSubmit' }, 'hook', this.activity()));
  }

  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    if (busy) this.requestBusy();
    else this.engine.release('dom:busy');
  }

  setPermissionDialog(visible: boolean): void {
    if (visible === this.permission) return;
    this.permission = visible;
    if (visible) this.requestPermission();
    else this.engine.release('dom:permission');
  }

  private requestBusy(): void {
    const rule = this.t.dom.claudeBusy;
    this.engine.request({
      name: 'dom:busy',
      kind: 'dom',
      priority: priorityOf(rule?.priority ?? 'thinking', this.t),
      steps: [...this.activity(), { clip: rule?.while ?? 'nachdenken', mode: 'loop' }],
    });
  }

  private requestPermission(): void {
    const rule = this.t.dom.permissionDialog;
    this.engine.request({
      name: 'dom:permission',
      kind: 'dom',
      priority: priorityOf(rule?.priority ?? 'attention', this.t),
      steps: [...this.activity(), { clip: rule?.while ?? 'bellen', mode: 'loop' }],
    });
  }

  // ----- interactions --------------------------------------------------------

  interact(name: string, steps: Step[], opts: { then?: Action['then']; onEnd?: Action['onEnd']; priority?: number } = {}): boolean {
    const wake = this.activity();
    return this.engine.request({
      name,
      kind: 'interaction',
      priority: opts.priority ?? this.P('interaction'),
      steps: [...wake, ...steps],
      then: opts.then ?? null,
      onEnd: opts.onEnd,
    });
  }

  /**
   * Context menu "Platz" / "Schlafen" and the idle timer: play the clips, then stay lying /
   * asleep. Menu commands count as activity; the idle timer must not reset the inactivity
   * clock (sleepAfterMs is measured from the last real activity).
   */
  restCommand(name: string, specs: string[], phase: IdlePhase, priority: number = this.P('interaction')): void {
    const userCommand = priority >= this.P('interaction');
    const steps = this.playSteps(specs.filter((s) => s !== 'liegen' && s !== 'schlafen'));
    if (userCommand) this.lastActivity = this.o.now();
    if (this.phase === phase) return;
    this.phase = 'sitting';
    this.engine.request({
      name,
      kind: userCommand ? 'interaction' : 'idle',
      priority,
      steps,
      onEnd: (reason) => {
        if (reason !== 'done') return;
        this.phase = phase;
        if (userCommand) this.lastActivity = this.o.now();
      },
    });
  }

  walkTo(x: number, priority: number, kind: ActionKind, name: string, prefix: Step[] = []): void {
    const seq = this.t.interactions.callDoubleClick as { sequence?: string[] } | undefined;
    const specs = seq?.sequence ?? ['umdrehen', 'gehen', 'umdrehen:reverse'];
    const steps: Step[] = [...prefix];
    for (const spec of specs) {
      if (spec.split(':')[0] === 'gehen') steps.push({ clip: spec, mode: 'loop', moveTo: x });
      else steps.push({ clip: spec });
    }
    this.engine.request({ name, kind, priority, steps });
  }

  randomSpot(): number {
    const { min, max } = this.o.bounds();
    const x = this.engine.x;
    for (let i = 0; i < 6; i++) {
      const target = Math.round(min + this.rnd() * Math.max(0, max - min));
      if (Math.abs(target - x) >= 12 || max - min < 24) return target;
    }
    return Math.round(min + this.rnd() * Math.max(0, max - min));
  }

  // ----- clock ---------------------------------------------------------------

  lieDownAfterMs(): number {
    return Math.min(this.t.idle.lieDownAfterMs, Math.round(this.settings.sleepAfterMs * 0.375));
  }

  update(dtMs: number): void {
    const now = this.o.now();
    const e = this.engine;

    if (this.typingUntil && now > this.typingUntil) {
      this.typingUntil = 0;
      e.release('dom:typing');
    }

    const cur = e.current;
    if (cur && !e.isBase() && cur.kind === 'hook' && e.inState() && now - this.lastHookAt > WHILE_TIMEOUT_MS) {
      e.interrupt();
    }

    if (!e.isBase()) return;

    // DOM states that are still true take over again once something else finished.
    if (this.permission) return this.requestPermission();
    if (this.busy) return this.requestBusy();

    const idleFor = now - this.lastActivity;
    if (this.phase === 'sitting' && idleFor > this.lieDownAfterMs()) {
      this.restCommand('idle:lieDown', this.t.idle.lieDown, 'lying', this.P('idle'));
      return;
    }
    if (this.phase === 'lying' && idleFor > Math.max(this.settings.sleepAfterMs, this.lieDownAfterMs() + 1000)) {
      this.restCommand('idle:sleep', this.t.idle.sleep, 'sleeping', this.P('idle'));
      return;
    }
    if (this.phase !== 'sitting' || this.settings.reduceMotion) return;

    const chance = (perSecond: number) => this.rnd() < 1 - Math.pow(1 - perSecond, dtMs / 1000);
    if (this.settings.wander && chance(this.t.idle.wander.chancePerSecond)) {
      this.wander();
    } else if (chance(this.t.idle.randomActions.chancePerSecond)) {
      this.randomAction();
    }
  }

  wander(): void {
    const target = this.randomSpot();
    const steps: Step[] = [];
    for (const spec of this.t.idle.wander.sequence) {
      const id = spec.split(':')[0];
      if (id === 'gehen') steps.push({ clip: spec, mode: 'loop', moveTo: target });
      else if (id === 'stehen') steps.push({ clip: spec, mode: 'loop', durationMs: 800 + Math.round(this.rnd() * 1600) });
      else steps.push({ clip: spec });
    }
    this.engine.request({ name: 'idle:wander', kind: 'idle', priority: this.P('idle'), steps });
  }

  randomAction(): void {
    const pick = this.t.idle.randomActions.pick;
    if (pick.length === 0) return;
    const id = pick[Math.floor(this.rnd() * pick.length)];
    const loops = (this.loopFlags ?? {})[id];
    const step: Step = loops ? { clip: id, mode: 'loop', durationMs: 1500 + Math.round(this.rnd() * 1500) } : { clip: id };
    this.engine.request({ name: `idle:random:${id}`, kind: 'idle', priority: this.P('idle'), steps: [step] });
  }

  /** For tests/diagnostics. */
  get isBusy(): boolean {
    return this.busy;
  }
}

