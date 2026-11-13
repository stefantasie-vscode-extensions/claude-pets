# Changelog

## 0.2.3 – 2026-11-13

- Notice at the top of the README: Claude Pets is coming to the Visual Studio Marketplace soon.
- The official "Support me on Ko-fi" button replaces the custom badge.

## 0.2.2 – 2026-11-13

- The Ko-fi badge is now Ko-fi blue instead of red.
- The Ko-fi cup is part of the "become a member on Ko-fi" link in the README text.

## 0.2.1 – 2026-11-13

- Ko-fi membership link at the top of the README and the extension details, with the Ko-fi logo.
- The "Sponsor" button in the extension details now leads to the membership page.

## 0.2.0 – 2026-11-13

- The whole extension is now in English: commands, settings, context menu, tooltips,
  notifications, diagnostics, README and docs.
- New extension identifier `stefantasie.claude-pets` (previously `kleywalker.claude-pets`);
  author: Stefan Kley.
- English pet ids and folder names (`dog`, `cat`, …). Settings saved by earlier versions
  (`hund`, `katze`, …, `zufall`) are migrated automatically.
- New README with an animated banner of all twelve pets, a Ko-fi link and a note about the icon.
- Sponsor link in the extension details.
- The uninstall script leaves patches and hooks alone while another Claude Pets installation is
  still present (e.g. when switching from the old identifier).

## 0.1.1 – 2026-11-12

- New artwork for the robot: a hovering robot with a visor and a jet flame
  (`atlas.json` and `objects.png` are unchanged).
- After an update with new code or new artwork, Claude Pets now always offers to reload the
  window – even while the pet is connected to the bridge. Settings changes still arrive without
  a reload.
- The bridge token is shared atomically between all VS Code windows (`~/.claude-pets/token`).

## 0.1.0 – 2026-11-12

First release.

- Pixel pet on the top edge of the Claude Code prompt box; follows changes in height and width of
  the box, banners docked on top of it and the permission card.
- 12 pets with 49 animations each; switch via context menu, command or setting.
- Animation engine with priorities, pose graph, blinking, walking and hopping.
- Idle life: wandering, random actions, lying down and falling asleep.
- Reactions to Claude Code hooks via a local bridge (HTTP/SSE) and to the UI (typing, Escape,
  Claude working, permission dialog).
- Interactions: petting, poking, bowl, treat, throwing a toy, rope, belly rub, calling, context menu.
- Commands, status bar item, diagnostics, clean disable and uninstall.
