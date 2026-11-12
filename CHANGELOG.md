# Changelog

## 0.1.1 – 2026-11-12

- Neue Grafik für den Roboter: ein schwebender Roboter mit Visier und Düsenflamme
  (Paket 2; `atlas.json` und `objects.png` sind unverändert).
- Nach einem Update mit neuem Code oder neuen Grafiken bietet Claude Pets jetzt immer an,
  das Fenster neu zu laden – auch wenn das Tier gerade mit der Bridge verbunden ist. Reine
  Einstellungsänderungen kommen weiterhin ohne Neuladen an.
- Das Bridge-Token wird zwischen allen VS-Code-Fenstern atomar geteilt
  (`~/.claude-pets/token`).

## 0.1.0 – 2026-11-12

Erste Version.

- Pixel-Haustier auf der Oberkante der Claude-Code-Promptbox, folgt Höhen- und
  Breitenänderungen der Box, angedockten Bannern und der Freigabekarte.
- 12 Tierarten mit je 49 Animationen, Wechsel per Kontextmenü, Befehl oder Einstellung.
- Animations-Engine mit Prioritäten, Posen-Graph, Blinzeln, Laufen und Hoppeln.
- Leerlauf mit Herumlaufen, Zufallsaktionen, Hinlegen und Einschlafen.
- Reaktionen auf Claude-Code-Hooks über eine lokale Bridge (HTTP/SSE) sowie auf die
  Oberfläche (Tippen, Escape, Claude arbeitet, Freigabe-Dialog).
- Interaktionen: Streicheln, Anstupsen, Napf, Leckerli, Spielzeug werfen, Seil,
  Bauch kraulen, Rufen, Kontextmenü.
- Befehle, Statusleiste, Diagnose, rückstandsloses Deaktivieren und Deinstallieren.
