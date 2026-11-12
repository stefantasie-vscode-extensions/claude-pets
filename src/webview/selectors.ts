// DOM selectors for Claude Code's webview, each with fallbacks.
//
// Determined from the webview bundle of Claude Code 2.1.322 (webview/index.js + index.css).
// Class names are CSS modules ("inputContainer_cKsPxg"); the hash suffix changes between
// builds, so we only match the stable prefix via [class*="name_"].
//
//   div.promptInputContainer_*                 (display:none while a permission card shows)
//     div.inputWrapper_*                       max-width 680px, centered
//       div.banner_*  (Sh)                     warnings such as "You've used 94% …";
//                                              border-radius 8 8 0 0, margin-bottom -8px:
//                                              docks onto the top of the input box
//       form
//         fieldset.inputContainer_*            the visible, bordered prompt box
//           div.messageInputContainer_*
//             div.messageInput_*[contenteditable=plaintext-only]
//                [role=textbox][aria-label="Message input"][data-placeholder]
//           div.inputFooter_*  … button.sendButton_*[type=submit][aria-label="Send message"|"Stop"]
//   div.permissionsContainer_* > div.permissionRequestContainer_*   (permission card)

/** The prompt text field (never read, only used for focus / input events / geometry). */
export const PROMPT_INPUT = [
  '[role="textbox"][aria-label="Message input"]',
  '[class*="messageInput_"][contenteditable]',
  '[contenteditable][data-placeholder]',
  'fieldset [contenteditable="plaintext-only"]',
  'form textarea',
];

/** The bordered box around the prompt field. */
export const PROMPT_BOX = ['fieldset[class*="inputContainer_"]', '[class*="inputContainer_"]', 'fieldset', 'form'];

/** Permission request card shown instead of the prompt box. */
export const PERMISSION_CARD = ['[class*="permissionRequestContainer_"]', '[class*="permissionsContainer_"] > *'];

/** Stop button / stop icon while Claude is working. */
export const BUSY_INDICATOR = [
  'button[type="submit"][aria-label="Stop"]',
  '[class*="sendButton_"] [class*="stopIcon_"]',
  '[class*="stopIcon_"]',
];

/** Send/stop button (to detect a prompt being sent by click). */
export const SUBMIT_BUTTON = ['button[type="submit"][class*="sendButton_"]', 'form button[type="submit"]'];

/** Floating UI that may cover the pet (menus, popups, dialogs, tooltips). */
export const FLOATING_UI = ['[role="menu"]', '[role="listbox"]', '[role="dialog"]', '[role="tooltip"]', '[role="alertdialog"]'];

/** Initial session id of a resumed session (used to bind the pet to its own session). */
export const ROOT_WITH_SESSION = '#root[data-initial-session]';

export function queryFirst<T extends Element = HTMLElement>(selectors: string[], root: ParentNode = document): T | null {
  for (const s of selectors) {
    try {
      const el = root.querySelector<T & Element>(s);
      if (el) return el as T;
    } catch {
      /* invalid selector in this engine – skip */
    }
  }
  return null;
}

export function queryAll(selectors: string[], root: ParentNode = document): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const s of selectors) {
    try {
      root.querySelectorAll<HTMLElement>(s).forEach((el) => out.add(el));
    } catch {
      /* skip */
    }
  }
  return [...out];
}

export function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el as HTMLElement).isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

/** First visible element matching any selector. */
export function firstVisible(selectors: string[], root: ParentNode = document): HTMLElement | null {
  for (const s of selectors) {
    let list: NodeListOf<HTMLElement>;
    try {
      list = root.querySelectorAll<HTMLElement>(s);
    } catch {
      continue;
    }
    for (const el of list) if (isVisible(el)) return el;
  }
  return null;
}

export function closestMatch(el: Element, selectors: string[]): HTMLElement | null {
  for (const s of selectors) {
    try {
      const m = el.closest<HTMLElement>(s);
      if (m) return m;
    } catch {
      /* skip */
    }
  }
  return null;
}
