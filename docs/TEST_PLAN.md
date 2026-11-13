# Manual test plan

Prerequisites: Claude Pets and Claude Code are installed, and the window was reloaded after the
notification "Claude Pets is ready". If anything looks wrong, run **Claude Pets: Show Diagnostics**
first. For details inside the webview use "Developer: Open Webview Developer Tools"; with
`claudePets.debug = true`, `window.__claudePets` is available there.

## Appearance

- [ ] The dog sits on the top edge of the Claude prompt box (feet exactly on the line).
- [ ] It breathes and wags (idle loop) and blinks every 3–6 s.
- [ ] Now and then it walks to another spot and sits down again.
- [ ] Multi-line text (Shift+Enter) makes the box grow – the pet moves up with it.
- [ ] A warning banner on top of the box (e.g. usage limit) – the pet sits on top of the banner.
- [ ] Make the panel narrower/wider – the pet stays within the box.
- [ ] Open the slash menu (`/`) – the pet hides while the menu covers it.
- [ ] Text in the box is never covered; clicks into the input field work everywhere.

## Claude events

- [ ] Typing → `zuschauen` (watch); back to idle 1.5 s after the last key press.
- [ ] Sending a prompt → `aufmerksam` (attentive), then `nachdenken` (think).
- [ ] Claude reads files (Read/Grep/Glob) → `schnueffeln` (sniff, walks slowly).
- [ ] Claude writes (Edit/Write) → `buddeln` (dig).
- [ ] Web search / WebFetch → `lauschen` (listen).
- [ ] `npm test` → `gespannt` (eager), then `freuen` (happy, green) or `traurig` (sad, red).
- [ ] `npm install` → `ungeduldig` (impatient); `git commit` → `nachdenken`, then `freuen`.
- [ ] Any other Bash command → `rennen` (run).
- [ ] Permission dialog → the pet sits on the permission card and `bellen` (barks); ends after the
      answer.
- [ ] Claude is done → `freuen`, then idle.
- [ ] Tool error → `traurig`.
- [ ] Escape while Claude is working → `ohren_anlegen` (ears back).
- [ ] Without hooks (`claudePets.hooks.enabled = false`, reload): "Claude working" still shows
      `nachdenken`, the permission dialog still `bellen`.

## Interactions

- [ ] Petting: move the mouse quickly back and forth over the pet → `streicheln` with hearts.
- [ ] Poking: click → a short startle, then `freuen`.
- [ ] Resting mouse over the pet while the prompt box has focus → the pet becomes translucent after
      0.6 s.
- [ ] The toolbar appears on hover and disappears 2 s after leaving; tooltips name the pet's things
      (cat: fish, yarn ball, feather wand).
- [ ] Bowl: a bowl appears next to the pet, it walks over and eats exactly above it for 4 s, then an
      empty bowl for 2 s.
- [ ] Treat: `leckerli_fangen`.
- [ ] Toy: drag and throw → flies with gravity, bounces, rolls out; the pet stalks, runs after it
      (never overtakes it), picks it up, brings it back, sits with it for 4 s, puts it down.
- [ ] Rope: hold it and pull it to the mouth → `zerrspiel` with a two-coloured line; letting go ends
      it.
- [ ] Belly rub: context menu *Lie down*, then circle with the mouse over the pet → rolls onto its
      back and wiggles while the mouse moves; afterwards rolls back.
- [ ] Calling: double-click just above the top edge of the box → the pet walks there and sits down.
- [ ] Context menu (right-click): Sit, Lie down, Give paw, Spin, Sleep, Change pet …, Hide (until
      reload). Escape or a click elsewhere closes it.

## Changing the pet

- [ ] Context menu → *Change pet …* → choose each of the 12 pets once.
- [ ] The setting `claudePets.species` follows the choice.
- [ ] "Claude Pets: Choose Pet…" or a click on "🐾 …" in the status bar switches the pet immediately
      (without reload while the bridge is connected).
- [ ] `random`: a different pet after every reload; the status bar shows the current one.
- [ ] Rabbit, frog and squirrel hop; the crab is never mirrored; the robot hovers.

## Disabling and uninstalling

- [ ] "Claude Pets: Disable" → reload hint; afterwards no pet, no `claude-pets` text left in
      Claude Code's `webview/index.js`, `webview/index.css` and `extension.js`, and no Claude Pets
      hooks in `~/.claude/settings.json`.
- [ ] "Claude Pets: Enable" restores everything.
- [ ] Uninstall the extension and restart VS Code → everything removed as above, plus
      `~/.claude-pets`.
- [ ] Update Claude Code → Claude Pets patches the new version and offers a reload.
