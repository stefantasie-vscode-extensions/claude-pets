// Overlay mounting: find the prompt box (or the permission card that replaces it), follow
// its top edge every frame – including banners docked onto it and height/width changes – and
// detect floating UI that covers the pet.
import {
  FLOATING_UI,
  PERMISSION_CARD,
  PROMPT_BOX,
  PROMPT_INPUT,
  closestMatch,
  firstVisible,
  isVisible,
} from './selectors';

export interface Edge {
  /** Viewport coordinates of the visible top edge of the box stack. */
  left: number;
  top: number;
  width: number;
}

export type AnchorKind = 'prompt' | 'permission';

const RESCAN_MS = 400;

export class Mount {
  readonly root: HTMLDivElement;
  readonly callStrip: HTMLDivElement;
  kind: AnchorKind | null = null;
  edge: Edge | null = null;
  box: HTMLElement | null = null;
  private stack: HTMLElement[] = [];
  private dirty = true;
  private lastScan = 0;
  private mo: MutationObserver | null = null;
  private ro: ResizeObserver | null = null;
  private observed = new Set<Element>();
  private applied = '';

  constructor(private readonly doc: Document = document) {
    this.root = doc.createElement('div');
    this.root.id = 'claude-pets-root';
    this.root.setAttribute('data-claude-pets', '');
    this.callStrip = doc.createElement('div');
    this.callStrip.className = 'cp-call-strip';
    this.root.appendChild(this.callStrip);
    this.attach();

    const markDirty = () => {
      this.dirty = true;
    };
    this.mo = new MutationObserver((records) => {
      for (const r of records) {
        // Ignore our own DOM churn.
        if (this.root.contains(r.target)) continue;
        this.dirty = true;
        return;
      }
    });
    this.mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    if (typeof ResizeObserver !== 'undefined') this.ro = new ResizeObserver(markDirty);
    window.addEventListener('resize', markDirty, { passive: true });
  }

  private attach(): void {
    if (!this.root.isConnected) this.doc.body.appendChild(this.root);
  }

  dispose(): void {
    this.mo?.disconnect();
    this.ro?.disconnect();
    this.root.remove();
  }

  /** The prompt field, if visible (used for focus checks and input events). */
  promptInput(): HTMLElement | null {
    return firstVisible(PROMPT_INPUT, this.doc);
  }

  /** Called every animation frame. Returns false while there is nothing to sit on. */
  update(now: number): boolean {
    this.attach();
    if (this.dirty || now - this.lastScan > RESCAN_MS || !this.box?.isConnected) {
      this.rescan();
      this.lastScan = now;
      this.dirty = false;
    }
    this.edge = this.measure();
    const css = this.edge
      ? `${Math.round(this.edge.left)}|${Math.round(this.edge.top)}|${Math.round(this.edge.width)}`
      : 'none';
    if (css !== this.applied) {
      this.applied = css;
      if (this.edge) {
        this.root.style.display = '';
        this.root.style.left = `${Math.round(this.edge.left)}px`;
        this.root.style.top = `${Math.round(this.edge.top)}px`;
        this.root.style.width = `${Math.round(this.edge.width)}px`;
      } else {
        this.root.style.display = 'none';
      }
    }
    return this.edge !== null;
  }

  private rescan(): void {
    let box: HTMLElement | null = null;
    let kind: AnchorKind | null = null;
    const input = firstVisible(PROMPT_INPUT, this.doc);
    if (input) {
      box = closestMatch(input, PROMPT_BOX);
      if (!box || !isVisible(box)) box = borderedAncestor(input);
      kind = 'prompt';
    }
    if (!box) {
      box = firstVisible(PERMISSION_CARD, this.doc);
      kind = box ? 'permission' : null;
    }
    this.box = box;
    this.kind = kind;
    this.stack = box ? [box, ...dockedAbove(box, this.root)] : [];
    this.observe(this.stack);
  }

  private observe(els: HTMLElement[]): void {
    if (!this.ro) return;
    const next = new Set<Element>(els);
    for (const el of this.observed) if (!next.has(el)) this.ro.unobserve(el);
    for (const el of next) if (!this.observed.has(el)) this.ro.observe(el);
    this.observed = next;
  }

  private measure(): Edge | null {
    if (!this.box || !this.box.isConnected) return null;
    const r = this.box.getBoundingClientRect();
    if (r.width < 40 || r.height < 8) return null;
    let top = r.top;
    for (const el of this.stack) {
      if (el === this.box || !el.isConnected) continue;
      const er = el.getBoundingClientRect();
      if (er.height >= 1 && er.top < top) top = er.top;
    }
    return { left: r.left, top, width: r.width };
  }

  /**
   * Is something floating (menu, popup, dialog, tooltip) over the given viewport rect?
   * Big layout containers (scroll areas) are not counted.
   */
  isOccluded(rect: { left: number; top: number; right: number; bottom: number }): boolean {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const points: [number, number][] = [
      [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
      [(rect.left + rect.right) / 2, rect.top + 2],
      [rect.left + 2, (rect.top + rect.bottom) / 2],
      [rect.right - 2, (rect.top + rect.bottom) / 2],
    ];
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
      const hits = this.doc.elementsFromPoint(x, y);
      const el = hits.find((h) => !this.root.contains(h) && !h.closest('[data-claude-pets]'));
      if (!el || el === this.doc.documentElement || el === this.doc.body) continue;
      if (closestMatch(el, FLOATING_UI)) return true;
      for (let a: Element | null = el; a && a !== this.doc.body; a = a.parentElement) {
        if (this.box && a.contains(this.box)) break;
        const pos = getComputedStyle(a).position;
        if (pos === 'absolute' || pos === 'fixed') {
          const ar = a.getBoundingClientRect();
          if (ar.width * ar.height < vw * vh * 0.5) return true;
          break;
        }
      }
    }
    return false;
  }
}

function hasVisibleBorder(el: Element): boolean {
  const cs = getComputedStyle(el);
  return parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'hidden';
}

/** Nearest ancestor with a visible top border (generic fallback). */
function borderedAncestor(el: HTMLElement): HTMLElement | null {
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    if (hasVisibleBorder(a) && isVisible(a)) return a;
  }
  return null;
}

/**
 * Elements docked onto the top of the box (warning/usage banners with a negative bottom
 * margin, attached file chips …): visible, in normal flow, touching or overlapping the stack's
 * current top edge and spanning most of its width.
 */
export function dockedAbove(box: HTMLElement, ignore?: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  const br = box.getBoundingClientRect();
  let top = br.top;
  let node: HTMLElement = box;
  for (let level = 0; level < 4; level++) {
    let sib = node.previousElementSibling as HTMLElement | null;
    while (sib) {
      if (sib === ignore) {
        sib = sib.previousElementSibling as HTMLElement | null;
        continue;
      }
      const r = sib.getBoundingClientRect();
      const cs = getComputedStyle(sib);
      if (r.height < 1 || cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'absolute' || cs.position === 'fixed') {
        sib = sib.previousElementSibling as HTMLElement | null;
        continue;
      }
      const overlap = Math.min(r.right, br.right) - Math.max(r.left, br.left);
      if (r.bottom >= top - 2 && r.top < top && overlap >= br.width * 0.6) {
        out.push(sib);
        top = r.top;
        sib = sib.previousElementSibling as HTMLElement | null;
        continue;
      }
      break;
    }
    const parent = node.parentElement;
    if (!parent || parent === document.body) break;
    // Climb only while the parent starts where our stack starts (nothing else above it inside).
    if (Math.abs(parent.getBoundingClientRect().top - top) > 2) break;
    node = parent;
  }
  return out;
}
