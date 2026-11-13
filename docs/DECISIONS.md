# Design decisions

This document records what was found while building Claude Pets, how the open points of the
original brief (`docs/PROMPT.md`, in German) were resolved and where the implementation
deliberately deviates from it. The analysis was done against Claude Code **2.1.322**
(`anthropic.claude-code-2.1.322-darwin-x64`).

## 1. Paths found in Claude Code

| What | Path (relative to the extension folder) | How it was found |
| --- | --- | --- |
| Webview script | `webview/index.js` (≈ 6 MB, ES module, `type="module"`) | standard path exists |
| Webview stylesheet | `webview/index.css` | standard path exists |
| HTML builder + CSP | `extension.js` (`package.json` → `main`), method `getHtmlForWebview()` | search for `Content-Security-Policy` |

`extension.js` builds the paths itself with
`He.Uri.joinPath(this.extensionUri,"webview","index.js")` and `…"index.css"`. The locator
(`src/claudeLocator.ts`) therefore checks, in this order: the standard paths → the files named
via `joinPath(…"webview","*.js|css")` in the HTML builder → the largest `.js`/`.css` in the
`webview` folder. The diagnostics show which way was used.

The extension is looked up via `vscode.extensions.all` (id compared case-insensitively). The
uninstall script has no VS Code API and scans `~/.vscode/extensions`,
`~/.vscode-insiders/extensions`, `~/.vscode-oss/extensions`, `~/.vscode-server*/extensions` and
`$VSCODE_EXTENSIONS` for `anthropic.claude-code-*`.

## 2. Content Security Policy: variant A

Claude Code sets this policy for its webview:

```text
default-src 'none'; style-src <cspSource> 'unsafe-inline'; font-src <cspSource>;
img-src <cspSource> data:; script-src 'nonce-…'; worker-src <cspSource>;
```

There is no `connect-src`, so `default-src 'none'` applies – `fetch`/`EventSource` to
`http://127.0.0.1` would be blocked. **Variant A** was chosen: a single expression is inserted into
the template string in `extension.js`:

```js
… script-src 'nonce-${d}'; ${v}; ${' connect-src http://127.0.0.1:* http://localhost:*;'/*claude-pets:csp*/}">
```

Reasons:

- The JS comment inside the template expression is the marker; the rendered HTML does not contain
  it. Removing means cutting out exactly this expression – the original is restored byte for byte
  (tested).
- Before writing, the modified `extension.js` is compiled with `vm.Script`; if it is syntactically
  broken, nothing is written. Backup `extension.js.claude-pets.bak`, atomic write, idempotent.
- Only policies with `script-src 'nonce-${…}'` are touched (Claude's webview); the second, static
  policy of the plan preview stays as it is.
- If a `connect-src` already exists, the sources are added there instead of appending a second
  directive (which would be ignored).

This touches a third file, beyond the two webview files the brief allowed – it is the variant A
the brief foresaw for this case. `claudePets.patchCsp = false` reverts it; then **variant B** runs
(DOM-only mode, hooks do not reach the pet). The diagnostics show the active variant.

Since `extension.js` is loaded when VS Code starts, the CSP change only takes effect after a window
reload – the same action the webview script needs anyway. In practice the webview of a reloaded
window keeps a permanent connection to the bridge, so variant A works.

## 3. Selectors (`src/webview/selectors.ts`)

Claude Code uses CSS modules (`inputContainer_cKsPxg`); the hash part changes between builds, so
only the prefix is matched (`[class*="inputContainer_"]`). ARIA attributes are preferred where
possible.

| Purpose | Selectors (order = priority) |
| --- | --- |
| prompt field | `[role="textbox"][aria-label="Message input"]` · `[class*="messageInput_"][contenteditable]` · `[contenteditable][data-placeholder]` · `fieldset [contenteditable="plaintext-only"]` · `form textarea` |
| bordered box | `fieldset[class*="inputContainer_"]` · `[class*="inputContainer_"]` · `fieldset` · `form` · otherwise the nearest ancestor with a visible top border |
| permission card | `[class*="permissionRequestContainer_"]` · `[class*="permissionsContainer_"] > *` |
| Claude working | `button[type="submit"][aria-label="Stop"]` · `[class*="sendButton_"] [class*="stopIcon_"]` · `[class*="stopIcon_"]` |
| send button | `button[type="submit"][class*="sendButton_"]` · `form button[type="submit"]` |
| floating UI | `[role="menu"]`, `[role="listbox"]`, `[role="dialog"]`, `[role="tooltip"]`, `[role="alertdialog"]` |
| session id | `#root[data-initial-session]` |

Important findings about the structure:

- Warnings such as "You've used 94% of your weekly limit" are **siblings** above the form
  (`div.banner_*`, `border-radius: 8px 8px 0 0`, `margin-bottom: -8px`) that visually dock onto the
  box. `mount.ts` collects such docked elements (visible, in normal flow, touching or overlapping
  the top edge, ≥ 60% of the box width) and puts the pet on the top edge of the whole stack.
- While a permission request is shown, the prompt area gets `display: none` and the permission card
  takes its place. The pet then moves onto the card.
- If a selector is not found, the feature silently falls away.

## 4. Deviations and clarifications

### Language and naming (0.2.0)

- The brief asked for a German UI. Since 0.2.0 everything is in English at Stefan's request:
  commands, settings, context menu, tooltips, notifications, diagnostics, README, CHANGELOG and
  these docs. Folder and file names are English as well (`assets/01_dog`, `docs/DECISIONS.md`, …).
- Pet ids are English (`dog`, `cat`, …, `random`). `atlas.json` got English species data, poses,
  groups, labels and notes; `triggers.json` got English context menu entries and comments
  (`feedButton.fresstDauerMs` is now `eatDurationMs`). The **canonical animation ids and frame
  names** (`sitzen`, `knochen_vergraben`, `sitzen_1` …) are unchanged: they are keys shared by all
  atlases, `triggers.json` and the code, not visible text.
- Settings saved by earlier versions (`hund`, `katze`, …, `zufall`) are migrated on activation
  (`normalizeSpecies()` in `src/config.ts`).
- The extension identifier changed from `kleywalker.claude-pets` to `stefantasie.claude-pets`;
  the author is "Stefan Kley". For a locally installed VSIX, VS Code shows the publisher **id** in
  the extension list: it only takes the publisher display name from Marketplace metadata, which a
  VSIX cannot carry. Once published, the display name comes from the publisher profile on the
  Marketplace.
- `package.json` points to the public GitHub mirror (`stefantasie-vscode-extensions/claude-pets`);
  `vsce` uses it to turn the relative links and the banner image in the README into absolute URLs.
  The primary repository stays on Gitea.

### Icon

- At Stefan's explicit request, `assets/icon.png` shows the upper half of the orange Claude logo
  inside the box (taken from `resources/claude-logo.svg` of the Claude Code extension, rasterised to
  the 1-px grid of the box corners). The original icon from the brief is in the first commit. The
  README explains this and offers to remove the logo should Anthropic object.

### Positioning

- The overlay `#claude-pets-root` is attached to `document.body` with `position: fixed`, not inside
  Claude's React tree. React can never remove it; its position is taken **every frame** from the
  measured rectangle of the box (plus docked banners). Pet, bowl and toy therefore follow every
  change in height and width (multi-line text, banners, a narrower panel). `MutationObserver` and
  `ResizeObserver` additionally trigger a new search.
- The clickable area is not the whole 24×24 frame but the opaque pixels of the current animation,
  at most down to row 22 – so as little as possible above the box is covered, and nothing inside it.
- When floating UI (slash menu, pop-ups, tooltips, dialogs) covers the pet, the pet is hidden and
  lets clicks through until the UI disappears. Its own elements (context menu, rope) do not count.

### Bridge and privacy

- **Session binding:** the webview cannot tell which VS Code window it belongs to and therefore
  connects to every reachable bridge (ports upwards from 47811, stopping after two misses). So that
  a pet only reacts to its own Claude session, every event carries `sid`, an 8-digit FNV-1a hash of
  the `session_id` (not reversible, no content). The pet binds via `data-initial-session` (resumed
  session) or via the first `UserPromptSubmit` within 4 s after a prompt was sent from its own
  webview. Unbound pets react to all sessions.
- `dist/hook.js` already sends a **slimmed** payload (event name, session id, `cwd`, tool name, the
  Bash command for the tag detection, status fields of `tool_response` without content). Prompts,
  file contents and tool output never leave the hook process. The host then filters down to event,
  tool, Bash tag, outcome and notification type, as required.
- **Token:** the source of truth is `~/.claude-pets/token` (mode 0600); `globalState` only mirrors
  it. Reason: during the first installation two open windows activated at the same moment,
  `globalState` is not atomic between windows, and they created different tokens – one of them did
  not match the embedded one. The file is created via `link()` (atomic, fails if it exists), so
  exactly one token wins.
- The bridge also checks the `Host` header (protection against DNS rebinding) and answers CORS
  preflights including `Access-Control-Allow-Private-Network`.
- Outcome of `PostToolUse`: according to the docs, a Bash command with a non-zero exit code arrives
  as `PostToolUseFailure` ("Exit code N"). `freuen` (happy) is therefore only played when a Bash
  `PostToolUse` has the known shape `{stdout, stderr, interrupted: false}` (or an explicit exit code
  0). Background commands, strings and anything unknown count as "unknown" (no reaction besides the
  follow-up state).

### Behaviour

- **Priorities:** a hook's `while` state ends with the next hook event (unless an `until` list
  forbids it); DOM signals strictly follow the priorities. One-shot animations play to the end;
  hooks arriving meanwhile are queued (the newest wins) and follow right after. Follow-up states
  (`then`) get the priority `min(own, thinking)`, so that e.g. Escape (`error`) can interrupt them.
- **Sending a prompt:** Enter in the prompt field (only if it is not empty – checked by the
  presence of child nodes, never by reading the text), a click on "Send" or – as a fallback – the
  appearance of the stop button immediately play `aufmerksam` → `nachdenken`. The `UserPromptSubmit`
  arriving shortly afterwards is only used for session binding (no double reaction).
- **Transitions:** explicitly listed transition animations (`umdrehen`, `hinlegen`,
  `auf_den_ruecken_rollen`, also `:reverse`) are skipped when the pet is not in their start pose; the
  pose graph does the rest. The graph's edges come from each pet's atlas (the crab, for example,
  rolls directly from `sit` to `belly`).
- **Waking up:** `aufwachen` is only played when the pet actually sleeps (it is dropped for
  `SessionStart` and when waking from merely lying).
- **Lying and sleeping:** lying down after `min(90 s, 37.5% of the sleep time)`, falling asleep
  after `claudePets.idle.sleepAfterMinutes` – both measured from the last real activity.
- **Mouse over a lying pet:** hovering does not wake a lying pet, and back-and-forth petting is not
  evaluated there – otherwise circling → belly rub could never be reached (a circle contains
  direction changes itself). Clicks, buttons and the menu wake it.
- `knochen_bringen` runs for 1.5 s on `SubagentStop` (note in `triggers.json`), `WorktreeCreate`
  uses `duration_ms`. Other looping animations in `play` lists play exactly one pass.
- Walking speeds exactly as specified (`gehen` 1 px per frame at 10 fps ≈ 20 CSS px/s at scale 2).
  Calling the pet across the whole box can therefore take 10–25 s.
- Hopping pets only move in frames whose lowest opaque row lies above the foot line (row 22) – this
  is determined from the atlas when it is loaded. If an animation has no such frame, it moves evenly.

### Settings and commands

- All settings have `"scope": "application"`: the injection is global, and differing workspace
  values would make windows re-patch each other back and forth.
- "Disable" removes the injection, the CSP addition **and** the hooks (the brief asks for complete
  removal); "Enable" sets everything up again.
- "Remove Hooks" sets `claudePets.hooks.enabled = false`, "Install Hooks" sets it to `true` –
  otherwise removed hooks would come back automatically on the next start.
- Settings changes are re-patched immediately **and** pushed live over the bridge to connected
  webviews (pet, scale, buttons, motion …).
- With `random`, the status bar shows the pet actually chosen (the webview reports it via
  `POST /species` with `persist: false`).

### Reloading after updates

- Settings travel live over the bridge; code, artwork and stylesheet live inside the injected block
  and only take effect after the webview reloads. `blockPayload()` therefore compares the block
  without the embedded configuration: if that part (or the CSS) changes, a reload is always offered.

### Uninstalling

- `vscode:uninstall` removes the blocks and the CSP addition in every Claude Code version found,
  the hooks and `~/.claude-pets`. Backups in Claude's folders are deleted when they are
  byte-identical to the restored file. `~/.claude/settings.json.claude-pets.bak` is deliberately
  kept as a safety net.
- It does nothing while another Claude Pets installation is still registered (`extensions.json`,
  ignoring entries listed in `.obsolete`). Otherwise removing the old `kleywalker.claude-pets` would
  wipe the patches and hooks of the new `stefantasie.claude-pets`.
- VS Code only runs `vscode:uninstall` on the next start after the uninstallation.

### Robot (package 2, version 0.1.1)

- The robot's `atlas.png` comes from the second asset package; all 363 frames were redrawn
  (hovering robot with a jet flame), `atlas.json` and `objects.png` stayed byte-identical. The icon
  in package 2 was the original one and was not taken over (see "Icon").
- In 98 frames the flame reaches row 23, one row below the foot line: it visibly touches the edge
  of the box. That is part of the artwork. The clickable area still ends at row 22.
- Since `v0.1.0` had already been published, the change was released as 0.1.1 rather than moving
  the tag.

### Banner

- `media/banner.gif` (840 × 64 px, 6 s loop) is rendered from the atlases by
  `scripts/make-banner.mjs` (`npm run make-banner`; `--preview out.png` writes three still frames).
  It uses an exact palette and integer 2× scaling so the pixel art stays crisp at README widths.
  It is not part of the VSIX; the README links it via the GitHub mirror.

### Tools

- TypeScript 5.9 instead of 7.x (the native compiler is still new; 5.9 is proven for `--noEmit`
  together with esbuild). `@types/vscode` is pinned to 1.90.0 to match `engines.vscode`.
- Debug mode (`claudePets.debug`): events in the output channel and in `~/.claude-pets/debug.log`;
  in the webview, `window.__claudePets` is available for the webview developer tools.
