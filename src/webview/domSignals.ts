// Signals read from Claude's UI: typing, Escape, prompt sent, Claude busy, permission dialog.
// The prompt text is never read – only that an input event happened.
import { BUSY_INDICATOR, PERMISSION_CARD, PROMPT_INPUT, SUBMIT_BUTTON, closestMatch, firstVisible } from './selectors';

export interface DomSignalHandlers {
  typing(): void;
  escape(): void;
  submit(): void;
  busy(on: boolean): void;
  permission(visible: boolean): void;
}

const POLL_MS = 250;
const SUBMIT_DEDUPE_MS = 3000;

export class DomSignals {
  private timer: number | null = null;
  private busy = false;
  private permission = false;
  private lastSubmit = -Infinity;
  private readonly onInput = (e: Event) => this.guard(() => this.handleInput(e));
  private readonly onKeyDown = (e: KeyboardEvent) => this.guard(() => this.handleKey(e));
  private readonly onClick = (e: MouseEvent) => this.guard(() => this.handleClick(e));

  constructor(
    private readonly h: DomSignalHandlers,
    private readonly doc: Document = document,
  ) {}

  start(): void {
    // Capture phase, passive: we only observe and never cancel anything.
    this.doc.addEventListener('input', this.onInput, { capture: true, passive: true });
    this.doc.addEventListener('keydown', this.onKeyDown, { capture: true, passive: true });
    this.doc.addEventListener('click', this.onClick, { capture: true, passive: true });
    this.timer = window.setInterval(() => this.guard(() => this.poll()), POLL_MS);
  }

  stop(): void {
    this.doc.removeEventListener('input', this.onInput, { capture: true });
    this.doc.removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.doc.removeEventListener('click', this.onClick, { capture: true });
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      /* never disturb Claude's UI */
    }
  }

  private isPrompt(target: EventTarget | null): target is Element {
    return target instanceof Element && !!closestMatch(target, PROMPT_INPUT);
  }

  private handleInput(e: Event): void {
    if (this.isPrompt(e.target)) this.h.typing();
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.busy) this.h.escape();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && this.isPrompt(e.target)) {
      // An empty field has no child nodes; that is all we look at (never the text).
      const field = closestMatch(e.target, PROMPT_INPUT);
      if (field && field.firstChild) this.submitted();
    }
  }

  private handleClick(e: MouseEvent): void {
    if (!(e.target instanceof Element)) return;
    const button = closestMatch(e.target, SUBMIT_BUTTON);
    if (button && !this.busy && button.getAttribute('aria-label') !== 'Stop' && !(button as HTMLButtonElement).disabled) {
      this.submitted();
    }
  }

  private submitted(): void {
    this.lastSubmit = performance.now();
    this.h.submit();
  }

  private poll(): void {
    const busy = !!firstVisible(BUSY_INDICATOR, this.doc);
    if (busy !== this.busy) {
      this.busy = busy;
      // Fallback for prompts sent in ways we did not see (e.g. a queued message).
      if (busy && performance.now() - this.lastSubmit > SUBMIT_DEDUPE_MS) this.submitted();
      this.h.busy(busy);
    }
    const permission = !!firstVisible(PERMISSION_CARD, this.doc);
    if (permission !== this.permission) {
      this.permission = permission;
      this.h.permission(permission);
    }
  }
}
