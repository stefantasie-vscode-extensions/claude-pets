import { describe, expect, it } from 'vitest';
import type { AnimDef, Pose } from '../src/shared/types';
import { Engine, buildPoseGraph, findTransition, parseClipRef, resolveClip, type Action } from '../src/webview/engine';

const A = (frames: string[], pose: [Pose, Pose], loop = false, fps = 10): AnimDef => ({ label: '', frames, fps, loop, pose });

const anims: Record<string, AnimDef> = {
  sitzen: A(['s1', 's2', 's3', 's4'], ['sit', 'sit'], true),
  stehen: A(['st1', 'st2'], ['stand', 'stand'], true),
  liegen: A(['l1', 'l2'], ['lie', 'lie'], true),
  umdrehen: A(['u1', 'u2', 'u3', 'u4'], ['sit', 'stand']),
  hinlegen: A(['h1', 'h2', 'h3', 'h4'], ['stand', 'lie']),
  auf_den_ruecken_rollen: A(['r1', 'r2'], ['lie', 'belly']),
  freuen: A(['f1', 'f2', 'f3'], ['sit', 'sit']),
  erschrecken: A(['e1', 'e2', 'e3', 'e4'], ['sit', 'sit']),
  gehen: A(['g1', 'g2'], ['stand', 'stand'], true),
  slow: A(['x1', 'x2'], ['sit', 'sit'], true, 4),
};

const base = (): Action => ({ name: 'idle', kind: 'idle', priority: 10, steps: [{ clip: 'sitzen', mode: 'loop' }] });

function make(width = 100) {
  return new Engine({ anims, gait: 'walk', bounds: () => ({ min: 0, max: width - 24 }), base });
}

/** Advance frame by frame (10 fps) and record the clip spec + frame of each step. */
function run(e: Engine, frames: number, dt = 100): string[] {
  const out: string[] = [];
  for (let i = 0; i < frames; i++) {
    const f = e.frame();
    out.push(`${e.currentClip?.spec}:${f?.frame}`);
    e.tick(dt);
  }
  return out;
}

describe('clip references', () => {
  it('parses reverse and ranges', () => {
    expect(parseClipRef('hinlegen:reverse')).toEqual({ id: 'hinlegen', reverse: true });
    expect(parseClipRef('erschrecken:2-3')).toEqual({ id: 'erschrecken', reverse: false, from: 2, to: 3 });
    expect(resolveClip(anims, 'umdrehen:reverse')?.frames).toEqual(['u4', 'u3', 'u2', 'u1']);
    expect(resolveClip(anims, 'umdrehen:reverse')?.startPose).toBe('stand');
    expect(resolveClip(anims, 'erschrecken:2-3')?.frames).toEqual(['e2', 'e3']);
    expect(resolveClip(anims, 'unbekannt')).toBeNull();
  });
});

describe('pose graph', () => {
  it('finds the shortest transition path', () => {
    const g = buildPoseGraph(anims);
    expect(findTransition(g, 'lie', 'sit')).toEqual(['hinlegen:reverse', 'umdrehen:reverse']);
    expect(findTransition(g, 'sit', 'belly')).toEqual(['umdrehen', 'hinlegen', 'auf_den_ruecken_rollen']);
    expect(findTransition(g, 'stand', 'stand')).toEqual([]);
  });

  it('derives edges from the atlas (crab: sit → belly directly)', () => {
    const crab = { ...anims, umdrehen: A(['u1'], ['sit', 'sit']), hinlegen: A(['h1'], ['sit', 'sit']), auf_den_ruecken_rollen: A(['r1'], ['sit', 'belly']) };
    expect(findTransition(buildPoseGraph(crab), 'belly', 'sit')).toEqual(['auf_den_ruecken_rollen:reverse']);
  });
});

describe('engine timing', () => {
  it('advances by fps', () => {
    const e = make();
    e.tick(0);
    expect(e.frame()?.frame).toBe('s1');
    e.tick(99);
    expect(e.frame()?.frame).toBe('s1');
    e.tick(1);
    expect(e.frame()?.frame).toBe('s2');
    e.tick(250);
    expect(e.frame()?.frame).toBe('s4');
  });

  it('loops looping clips', () => {
    const e = make();
    e.tick(0);
    expect(run(e, 6).map((s) => s.split(':').pop())).toEqual(['s1', 's2', 's3', 's4', 's1', 's2']);
  });

  it('plays one-shots once and returns to the base', () => {
    const e = make();
    e.tick(0);
    e.request({ name: 'happy', kind: 'hook', priority: 60, steps: [{ clip: 'freuen' }] });
    expect(run(e, 5)).toEqual(['freuen:f1', 'freuen:f2', 'freuen:f3', 'sitzen:s1', 'sitzen:s2']);
    expect(e.isBase()).toBe(true);
  });

  it('plays reverse clips and frame ranges', () => {
    const e = make();
    e.pose = 'stand';
    e.request({ name: 'sitdown', kind: 'hook', priority: 60, steps: [{ clip: 'umdrehen:reverse' }, { clip: 'erschrecken:2-3' }] });
    expect(run(e, 7)).toEqual([
      'umdrehen:reverse:u4',
      'umdrehen:reverse:u3',
      'umdrehen:reverse:u2',
      'umdrehen:reverse:u1',
      'erschrecken:2-3:e2',
      'erschrecken:2-3:e3',
      'sitzen:s1',
    ]);
  });

  it('runs a looping step for its duration and honours slower fps', () => {
    const e = make();
    e.tick(0);
    e.request({ name: 'x', kind: 'hook', priority: 60, steps: [{ clip: 'slow', mode: 'loop', durationMs: 1000 }] });
    expect(e.frame()?.frame).toBe('x1');
    e.tick(250);
    expect(e.frame()?.frame).toBe('x2');
    e.tick(500);
    expect(e.frame()?.frame).toBe('x2');
    e.tick(300);
    expect(e.isBase()).toBe(true);
  });
});

describe('engine priorities', () => {
  it('lets a higher priority interrupt a one-shot immediately', () => {
    const e = make();
    e.tick(0);
    let ended = '';
    e.request({ name: 'low', kind: 'hook', priority: 20, steps: [{ clip: 'freuen' }], onEnd: (r) => (ended = r) });
    e.tick(100);
    expect(e.request({ name: 'high', kind: 'interaction', priority: 90, steps: [{ clip: 'erschrecken' }] })).toBe(true);
    expect(ended).toBe('interrupted');
    expect(e.current?.name).toBe('high');
    expect(e.frame()?.frame).toBe('e1');
  });

  it('lets one-shots finish and queues the newest equal/hook request', () => {
    const e = make();
    e.tick(0);
    e.request({ name: 'a', kind: 'hook', priority: 50, steps: [{ clip: 'freuen' }] });
    expect(e.request({ name: 'b', kind: 'hook', priority: 50, steps: [{ clip: 'erschrecken' }] })).toBe(true);
    expect(e.request({ name: 'c', kind: 'hook', priority: 50, steps: [{ clip: 'erschrecken:2-3' }] })).toBe(true);
    expect(e.current?.name).toBe('a');
    expect(run(e, 5)).toEqual(['freuen:f1', 'freuen:f2', 'freuen:f3', 'erschrecken:2-3:e2', 'erschrecken:2-3:e3']);
  });

  it('rejects lower non-hook requests during a one-shot', () => {
    const e = make();
    e.tick(0);
    e.request({ name: 'a', kind: 'hook', priority: 60, steps: [{ clip: 'freuen' }] });
    expect(e.request({ name: 'typing', kind: 'dom', priority: 35, steps: [{ clip: 'stehen', mode: 'loop' }] })).toBe(false);
  });

  it('ends a hook state with the next hook event, unless "until" forbids it', () => {
    const e = make();
    e.tick(0);
    e.request({ name: 'PreToolUse', kind: 'hook', priority: 50, steps: [{ clip: 'stehen', mode: 'loop' }] });
    // First the inserted transition (sit → stand) plays; that is still the one-shot part.
    expect(e.currentClip?.spec).toBe('umdrehen');
    expect(e.inState()).toBe(false);
    run(e, 4);
    expect(e.currentClip?.spec).toBe('stehen');
    expect(e.inState()).toBe(true);
    expect(e.request({ name: 'MessageDisplay', kind: 'hook', priority: 35, steps: [{ clip: 'freuen' }] })).toBe(true);
    expect(e.current?.name).toBe('MessageDisplay');

    e.request({ name: 'PermissionRequest', kind: 'hook', priority: 80, until: ['Stop'], steps: [{ clip: 'sitzen', mode: 'loop' }] });
    run(e, 5);
    expect(e.request({ name: 'MessageDisplay', kind: 'hook', priority: 35, steps: [{ clip: 'freuen' }] })).toBe(false);
    expect(e.request({ name: 'Stop', kind: 'hook', priority: 60, steps: [{ clip: 'freuen' }] })).toBe(true);
    expect(e.current?.name).toBe('Stop');
  });

  it('applies a queued action once the one-shot part reaches its state', () => {
    const e = make();
    e.tick(0);
    e.request({ name: 'Submit', kind: 'hook', priority: 80, steps: [{ clip: 'freuen' }, { clip: 'sitzen', mode: 'loop' }] });
    e.request({ name: 'Read', kind: 'hook', priority: 50, steps: [{ clip: 'erschrecken' }] });
    run(e, 3);
    expect(e.current?.name).toBe('Read');
  });

  it('releases DOM states by name', () => {
    const e = make();
    e.tick(0);
    e.request({ name: 'dom:typing', kind: 'dom', priority: 35, steps: [{ clip: 'erschrecken', mode: 'loop' }] });
    expect(e.current?.name).toBe('dom:typing');
    e.release('dom:typing');
    expect(e.isBase()).toBe(true);
  });
});

describe('engine poses and movement', () => {
  it('inserts hinlegen:reverse + umdrehen:reverse from lie to sit', () => {
    const e = make();
    e.pose = 'lie';
    e.request({ name: 'happy', kind: 'hook', priority: 60, steps: [{ clip: 'freuen' }] });
    const seq = run(e, 9).map((s) => s.split(':').slice(0, -1).join(':'));
    expect(seq).toEqual([
      'hinlegen:reverse',
      'hinlegen:reverse',
      'hinlegen:reverse',
      'hinlegen:reverse',
      'umdrehen:reverse',
      'umdrehen:reverse',
      'umdrehen:reverse',
      'umdrehen:reverse',
      'freuen',
    ]);
  });

  it('skips explicit transitions that do not start from the current pose', () => {
    const e = make();
    e.pose = 'stand';
    e.request({ name: 'walk', kind: 'idle', priority: 10, steps: [{ clip: 'umdrehen' }, { clip: 'stehen', mode: 'loop', durationMs: 200 }] });
    expect(e.currentClip?.spec).toBe('stehen');
  });

  it('walks to a target and turns around at the edges', () => {
    const e = make(100);
    e.x = 10;
    e.pose = 'stand';
    e.request({ name: 'walk', kind: 'idle', priority: 10, steps: [{ clip: 'gehen', mode: 'loop', moveTo: 5 }] });
    expect(e.facing).toBe(-1);
    expect(e.frame()?.flip).toBe(true);
    run(e, 8);
    expect(e.x).toBe(5);
    expect(e.isBase()).toBe(true);
    // Free roaming bounces at max = 76.
    e.x = 74;
    e.facing = 1;
    e.pose = 'stand';
    e.request({ name: 'run', kind: 'hook', priority: 50, steps: [{ clip: 'gehen', mode: 'loop', speed: 3 }] });
    run(e, 3);
    expect(e.x).toBeLessThanOrEqual(76);
    expect(e.facing).toBe(-1);
  });

  it('never mirrors front views', () => {
    const e = make();
    e.facing = -1;
    e.tick(0);
    expect(e.frame()?.pose).toBe('sit');
    expect(e.frame()?.flip).toBe(false);
  });
});
