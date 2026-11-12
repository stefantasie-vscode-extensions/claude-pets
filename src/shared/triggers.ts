// Typed access to triggers.json – the single source of truth for the pet's behaviour.
import raw from '../../triggers.json';
import type { BashTag } from './types';

export interface PlayRule {
  play?: string[];
  while?: string;
  then?: string;
  priority?: string;
  until?: string[];
  action?: string;
  duration_ms?: number;
  note?: string;
}

export interface BashCommandRule {
  match: string;
  while: string;
  tag: BashTag;
}

export interface Triggers {
  priorities: Record<string, number>;
  hooks: Record<string, unknown>;
  dom: Record<string, PlayRule & { stopAfterMs?: number }>;
  idle: {
    base: string;
    blink: { everyMs: [number, number]; sequence: string[]; frameMs: number; appliesTo: string[] };
    wander: { chancePerSecond: number; sequence: string[]; speedPxPerFrame: number };
    randomActions: { chancePerSecond: number; pick: string[] };
    lieDownAfterMs: number;
    sleepAfterMs: number;
    lieDown: string[];
    sleep: string[];
    wakeUp: string[];
  };
  interactions: Record<string, unknown> & {
    contextMenu: Record<string, string[] | string>;
  };
}

export const triggers = raw as unknown as Triggers;

/** All hook event names configured in triggers.json (keys starting with "_" are comments). */
export function hookEventNames(t: Triggers = triggers): string[] {
  return Object.keys(t.hooks).filter((k) => !k.startsWith('_'));
}

export function priorityOf(name: string | undefined, t: Triggers = triggers): number {
  if (!name) return t.priorities.ambient ?? 20;
  const p = t.priorities[name];
  return typeof p === 'number' ? p : (t.priorities.ambient ?? 20);
}

interface ByToolTable {
  _byTool: Record<string, PlayRule & { _byCommand?: BashCommandRule[] }>;
}

function byTool(t: Triggers): ByToolTable['_byTool'] {
  return ((t.hooks.PreToolUse as ByToolTable | undefined)?._byTool ?? {}) as ByToolTable['_byTool'];
}

/** Rule for a PreToolUse event by tool name ("Read|Grep" style keys, "*" as fallback). */
export function toolRule(toolName: string | undefined, t: Triggers = triggers): (PlayRule & { _byCommand?: BashCommandRule[] }) | undefined {
  const table = byTool(t);
  if (toolName) {
    for (const [pattern, rule] of Object.entries(table)) {
      if (pattern === '*' || pattern.startsWith('_')) continue;
      if (pattern.split('|').includes(toolName)) return rule;
    }
  }
  return table['*'];
}

const regexCache = new Map<string, RegExp | null>();
function compile(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern));
    } catch {
      regexCache.set(pattern, null);
    }
  }
  return regexCache.get(pattern) ?? null;
}

/** First matching Bash command rule (test/install/commit/bash) for a shell command. */
export function bashRule(command: string, t: Triggers = triggers): BashCommandRule | undefined {
  const rules = byTool(t).Bash?._byCommand ?? [];
  for (const rule of rules) {
    const re = compile(rule.match);
    if (re && re.test(command)) return rule;
  }
  return undefined;
}

export function bashTag(command: string, t: Triggers = triggers): BashTag | undefined {
  return bashRule(command, t)?.tag;
}

/** The "while" animation for a Bash tag. */
export function bashWhileForTag(tag: BashTag, t: Triggers = triggers): string | undefined {
  return (byTool(t).Bash?._byCommand ?? []).find((r) => r.tag === tag)?.while;
}

/** Collect every animation id referenced anywhere in triggers.json (used by tests). */
export function referencedAnimationIds(t: Triggers = triggers): string[] {
  const ids = new Set<string>();
  const nonAnim = new Set(['idle', 'openSpeciesPicker']);
  const add = (s: unknown) => {
    if (typeof s !== 'string' || nonAnim.has(s)) return;
    ids.add(s.split(':')[0]);
  };
  const walk = (node: unknown, key?: string) => {
    if (Array.isArray(node)) {
      // "until" lists hook events, "everyMs" numbers; blink.sequence holds eye states.
      if (key === 'until' || key === 'everyMs') return;
      for (const v of node) {
        if (typeof v === 'string') {
          if (v === 'half' || v === 'closed') continue;
          add(v);
        } else walk(v);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith('_info') || k === 'note' || k === 'notation' || k === 'priorities' || k === 'priority') continue;
        if (k === 'until' || k === 'match' || k === 'tag' || k === 'action') continue;
        if (typeof v === 'string') {
          if (k === 'while' || k === 'then' || k === 'base') add(v);
          continue;
        }
        walk(v, k);
      }
    }
  };
  walk(t.hooks);
  walk(t.dom);
  walk(t.idle);
  walk(t.interactions);
  return [...ids].sort();
}
