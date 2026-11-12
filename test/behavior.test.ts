import { describe, expect, it } from 'vitest';
import { classifyPostToolUse, sanitizeHookPayload, slimHookPayload } from '../src/shared/events';
import { triggers } from '../src/shared/triggers';
import type { AnimDef, PetEvent } from '../src/shared/types';
import { Behavior, planForHook } from '../src/webview/behavior';
import { Engine } from '../src/webview/engine';

const ev = (payload: Record<string, unknown>): PetEvent => sanitizeHookPayload(payload, 0)!;
const pre = (tool: string, input: Record<string, unknown> = {}) => ev({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const bash = (command: string) => pre('Bash', { command });

describe('PreToolUse mapping', () => {
  it('maps tools to animations', () => {
    expect(planForHook(pre('Read'), triggers)?.while).toBe('schnueffeln');
    expect(planForHook(pre('Grep'), triggers)?.while).toBe('schnueffeln');
    expect(planForHook(pre('Edit'), triggers)?.while).toBe('buddeln');
    expect(planForHook(pre('Write'), triggers)?.while).toBe('buddeln');
    expect(planForHook(pre('WebFetch'), triggers)?.while).toBe('lauschen');
    expect(planForHook(pre('AskUserQuestion'), triggers)).toMatchObject({ while: 'fragend', priority: triggers.priorities.attention });
    expect(planForHook(pre('mcp__github__create_issue'), triggers)).toMatchObject({ while: 'nachdenken', priority: triggers.priorities.thinking });
  });

  it('tags Bash commands (test, install, commit, bash)', () => {
    const cases: [string, string, string][] = [
      ['npm test', 'test', 'gespannt'],
      ['npm run test -- --watch=false', 'test', 'gespannt'],
      ['npx vitest run', 'test', 'gespannt'],
      ['cd app && pnpm test', 'test', 'gespannt'],
      ['cargo test --all', 'test', 'gespannt'],
      ['pytest -q', 'test', 'gespannt'],
      ['npm install', 'install', 'ungeduldig'],
      ['pnpm add lodash', 'install', 'ungeduldig'],
      ['brew install jq', 'install', 'ungeduldig'],
      ['git commit -m "Fix"', 'commit', 'nachdenken'],
      ['ls -la', 'bash', 'rennen'],
      ['git status', 'bash', 'rennen'],
    ];
    for (const [command, tag, anim] of cases) {
      const e = bash(command);
      expect(e.tag, command).toBe(tag);
      expect(planForHook(e, triggers)?.while, command).toBe(anim);
      expect(planForHook(e, triggers)?.priority).toBe(triggers.priorities.tool);
    }
  });
});

describe('PostToolUse success / failure', () => {
  const post = (command: string, response: unknown) =>
    ev({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: response });

  it('classifies tool responses conservatively', () => {
    expect(classifyPostToolUse({ tool_name: 'Bash', tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } })).toBe('success');
    expect(classifyPostToolUse({ tool_name: 'Bash', tool_response: { stdout: '', stderr: '', interrupted: true } })).toBe('failure');
    expect(classifyPostToolUse({ tool_name: 'Bash', tool_response: { exit_code: 1 } })).toBe('failure');
    expect(classifyPostToolUse({ tool_name: 'Bash', tool_response: { is_error: true } })).toBe('failure');
    expect(classifyPostToolUse({ tool_name: 'Bash', tool_input: { run_in_background: true }, tool_response: { stdout: '' } })).toBe('unknown');
    expect(classifyPostToolUse({ tool_name: 'Bash', tool_response: 'text' })).toBe('unknown');
    expect(classifyPostToolUse({ tool_name: 'Write', tool_response: { filePath: '/x', type: 'create' } })).toBe('unknown');
  });

  it('plays freuen / traurig after tests and freuen after commits', () => {
    expect(planForHook(post('npm test', { stdout: 'all good', stderr: '', interrupted: false }), triggers)).toMatchObject({ play: ['freuen'], then: 'nachdenken' });
    expect(planForHook(post('npm test', { stdout: '', stderr: '', interrupted: true }), triggers)?.play).toEqual(['traurig']);
    expect(planForHook(post('npm test', 'weird'), triggers)?.play).toEqual([]);
    expect(planForHook(post('git commit -m x', { stdout: '[main 1a2b] x', stderr: '' }), triggers)?.play).toEqual(['freuen']);
    expect(planForHook(post('git commit -m x', { interrupted: true, stdout: '' }), triggers)?.play).toEqual([]);
    expect(planForHook(post('ls', { stdout: 'a', stderr: '' }), triggers)?.play).toEqual([]);
  });

  it('uses the remembered tag when the PostToolUse event has none', () => {
    const e: PetEvent = { event: 'PostToolUse', tool: 'Bash', outcome: 'success', ts: 0 };
    expect(planForHook(e, triggers, 'test')?.play).toEqual(['freuen']);
  });

  it('maps failures, notifications and other events', () => {
    expect(planForHook(ev({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', error: 'Exit code 1' }), triggers)).toMatchObject({ play: ['traurig'], priority: triggers.priorities.error });
    expect(planForHook(ev({ hook_event_name: 'Notification', notification_type: 'agent_completed' }), triggers)).toMatchObject({ play: ['freuen'], then: 'idle' });
    expect(planForHook(ev({ hook_event_name: 'Notification', notification_type: 'agent_needs_input' }), triggers)?.while).toBe('bellen');
    expect(planForHook(ev({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }), triggers)?.play).toEqual(['aufmerksam']);
    expect(planForHook(ev({ hook_event_name: 'Stop' }), triggers)).toMatchObject({ play: ['freuen'], then: 'idle' });
    expect(planForHook(ev({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }), triggers)).toMatchObject({ while: 'bellen' });
    expect(planForHook(ev({ hook_event_name: 'CwdChanged' }), triggers)?.action).toBe('walkToRandomSpot');
    expect(planForHook(ev({ hook_event_name: 'SomethingNew' }), triggers)).toBeNull();
  });
});

describe('privacy filter', () => {
  it('passes only what the pet needs', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      session_id: 'abc-123',
      prompt: 'geheim',
      transcript_path: '/x',
      cwd: '/home/u/p',
      tool_name: 'Bash',
      tool_input: { command: 'npm test -- --token=SECRET', description: 'Run tests' },
    };
    const e = sanitizeHookPayload(raw, 1)!;
    expect(Object.keys(e).sort()).toEqual(['event', 'sid', 'tag', 'tool', 'ts']);
    expect(JSON.stringify(e)).not.toContain('SECRET');
    expect(e.sid).toMatch(/^[0-9a-f]{8}$/);
    const slim = slimHookPayload({ ...raw, tool_response: { stdout: 'SECRET', stderr: 'x', interrupted: false } })!;
    expect(JSON.stringify(slim)).not.toContain('geheim');
    expect(JSON.stringify(slim)).not.toContain('Run tests');
    expect((slim.tool_response as Record<string, unknown>).stdout).toBe('');
    expect(sanitizeHookPayload(slim, 1)).toEqual(e);
    expect(sanitizeHookPayload({ hook_event_name: '<script>' })).toBeNull();
  });
});

describe('Behavior', () => {
  const A = (frames: string[], pose: AnimDef['pose'], loop = false): AnimDef => ({ label: '', frames, fps: 10, loop, pose });
  const anims: Record<string, AnimDef> = {};
  for (const id of ['sitzen', 'aufmerksam', 'nachdenken', 'freuen', 'zuschauen', 'bellen', 'traurig', 'nicken']) anims[id] = A([id + '1', id + '2'], ['sit', 'sit'], true);
  for (const id of ['stehen', 'gehen', 'schnueffeln', 'strecken']) anims[id] = A([id + '1', id + '2'], ['stand', 'stand'], true);
  for (const id of ['liegen', 'schlafen', 'einschlafen', 'aufwachen']) anims[id] = A([id + '1', id + '2'], ['lie', 'lie'], true);
  anims.umdrehen = A(['u1', 'u2'], ['sit', 'stand']);
  anims.hinlegen = A(['h1', 'h2'], ['stand', 'lie']);

  function setup() {
    let now = 0;
    let engine!: Engine;
    const b = new Behavior({ triggers, engine: () => engine, now: () => now, random: () => 0.99, bounds: () => ({ min: 0, max: 100 }) });
    engine = new Engine({ anims, gait: 'walk', bounds: () => ({ min: 0, max: 100 }), base: () => b.baseAction() });
    b.loopFlags = Object.fromEntries(Object.entries(anims).map(([k, v]) => [k, v.loop]));
    engine.tick(0);
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        now += 100;
        b.update(100);
        engine.tick(100);
      }
    };
    return { b, engine, advance, setNow: (n: number) => (now = n) };
  }

  it('binds to its own session after a local submit and ignores others', () => {
    const { b, engine } = setup();
    b.onLocalSubmit();
    expect(engine.currentClip?.id).toBe('aufmerksam');
    b.onHook({ event: 'UserPromptSubmit', sid: 'aaaa', ts: 0 });
    expect(b.boundSid).toBe('aaaa');
    b.onHook({ event: 'PreToolUse', tool: 'Read', sid: 'bbbb', ts: 0 });
    expect(engine.current?.name).toBe('UserPromptSubmit');
    expect(engine.pending).toBeNull();
    // Lower priority than the running one-shot "aufmerksam": queued, plays right after it.
    b.onHook({ event: 'Stop', sid: 'aaaa', ts: 0 });
    expect(engine.pending?.name).toBe('Stop');
  });

  it('lies down, falls asleep and wakes up on activity', () => {
    const { b, engine, advance } = setup();
    b.settings = { wander: false, sleepAfterMs: 240000, reduceMotion: true };
    advance(91000);
    expect(b.phase).toBe('lying');
    expect(engine.pose).toBe('lie');
    advance(150000);
    expect(b.phase).toBe('sleeping');
    expect(engine.currentClip?.id).toBe('schlafen');
    b.onTyping();
    expect(b.phase).toBe('sitting');
    expect(engine.currentClip?.id).toBe('aufwachen');
    advance(3000);
    expect(engine.pose).toBe('sit');
  });

  it('ends hook states after 60 s without events', () => {
    const { b, engine, advance } = setup();
    b.onHook({ event: 'PreToolUse', tool: 'Read', ts: 0 });
    expect(engine.current?.name).toBe('PreToolUse');
    advance(59000);
    expect(engine.current?.name).toBe('PreToolUse');
    advance(2000);
    expect(engine.isBase()).toBe(true);
  });

  it('shows typing only for 1.5 s after the last input', () => {
    const { b, engine, advance } = setup();
    b.onTyping();
    expect(engine.current?.name).toBe('dom:typing');
    advance(1000);
    b.onTyping();
    advance(1000);
    expect(engine.current?.name).toBe('dom:typing');
    advance(700);
    expect(engine.isBase()).toBe(true);
  });
});
