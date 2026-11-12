// Turning raw Claude Code hook payloads into the minimal PetEvent the webview may see.
import { bashTag } from './triggers';
import type { Outcome, PetEvent } from './types';

/** Events whose tool_name is meaningful. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** FNV-1a 32 bit – a short, stable, non-reversible id for routing (not a security feature). */
export function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Success/failure of a PostToolUse event. Only an unambiguous success yields "success".
 * Per the hook docs, a Bash command with a non-zero exit code arrives as PostToolUseFailure
 * ("Exit code N"); a PostToolUse for Bash carries {stdout, stderr, interrupted, isImage}.
 */
export function classifyPostToolUse(payload: Obj): Outcome {
  const input = isObj(payload.tool_input) ? payload.tool_input : {};
  if (input.run_in_background === true) return 'unknown';
  const r = payload.tool_response;
  if (!isObj(r)) return 'unknown';
  if (r.interrupted === true || r.is_error === true || r.isError === true) return 'failure';
  for (const key of ['exit_code', 'exitCode', 'returnCode']) {
    const v = r[key];
    if (typeof v === 'number') return v === 0 ? 'success' : 'failure';
  }
  if ((typeof r.error === 'string' && r.error.length > 0) || isObj(r.error)) return 'failure';
  if (r.backgroundTaskId !== undefined && r.backgroundTaskId !== null && r.backgroundTaskId !== '') return 'unknown';
  if (payload.tool_name === 'Bash' && (typeof r.stdout === 'string' || typeof r.stderr === 'string')) return 'success';
  return 'unknown';
}

/** Reduce a raw hook payload to a PetEvent. Returns null for anything that is not a hook event. */
export function sanitizeHookPayload(payload: unknown, now: number = Date.now()): PetEvent | null {
  if (!isObj(payload)) return null;
  const event = payload.hook_event_name;
  if (typeof event !== 'string' || !/^[A-Za-z]{1,48}$/.test(event)) return null;
  const out: PetEvent = { event, ts: now };
  if (typeof payload.session_id === 'string' && payload.session_id) out.sid = hashId(payload.session_id);
  if (TOOL_EVENTS.has(event) && typeof payload.tool_name === 'string') {
    out.tool = payload.tool_name.slice(0, 80);
    if (out.tool === 'Bash') {
      const command = isObj(payload.tool_input) ? payload.tool_input.command : undefined;
      if (typeof command === 'string') out.tag = bashTag(command);
    }
  }
  if (event === 'PostToolUse') out.outcome = classifyPostToolUse(payload);
  if (event === 'PostToolUseFailure') out.outcome = 'failure';
  if (event === 'Notification' && typeof payload.notification_type === 'string') {
    out.notification = payload.notification_type.slice(0, 60);
  }
  return out;
}

/**
 * Strip a hook payload down to what the extension host needs for sanitizeHookPayload() and
 * routing, so prompts, file contents and tool output never leave the hook process.
 * String values whose content is irrelevant are replaced by "" (their type is kept).
 */
export function slimHookPayload(payload: unknown): Obj | null {
  if (!isObj(payload)) return null;
  const out: Obj = {};
  for (const key of ['hook_event_name', 'session_id', 'cwd', 'tool_name', 'notification_type']) {
    if (typeof payload[key] === 'string') out[key] = payload[key];
  }
  if (isObj(payload.tool_input)) {
    const ti: Obj = {};
    if (payload.tool_name === 'Bash' && typeof payload.tool_input.command === 'string') {
      ti.command = payload.tool_input.command.slice(0, 2000);
    }
    if (payload.tool_input.run_in_background === true) ti.run_in_background = true;
    out.tool_input = ti;
  }
  if (isObj(payload.tool_response)) {
    const r = payload.tool_response;
    const tr: Obj = {};
    for (const key of ['interrupted', 'is_error', 'isError']) if (typeof r[key] === 'boolean') tr[key] = r[key];
    for (const key of ['exit_code', 'exitCode', 'returnCode']) if (typeof r[key] === 'number') tr[key] = r[key];
    if (typeof r.error === 'string') tr.error = r.error.length > 0 ? 'x' : '';
    else if (isObj(r.error)) tr.error = {};
    if (r.backgroundTaskId !== undefined && r.backgroundTaskId !== null && r.backgroundTaskId !== '') tr.backgroundTaskId = 'x';
    if (typeof r.stdout === 'string') tr.stdout = '';
    if (typeof r.stderr === 'string') tr.stderr = '';
    out.tool_response = tr;
  }
  return out;
}
