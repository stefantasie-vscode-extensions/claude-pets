# Manueller Testplan

Voraussetzungen: Claude Pets und Claude Code installiert, Fenster nach dem Hinweis „Claude
Pets ist bereit“ neu geladen. Bei Problemen zuerst **Claude Pets: Diagnose** ausführen.
Für Details im Webview: „Developer: Open Webview Developer Tools“, mit `claudePets.debug = true`
steht dort `window.__claudePets` zur Verfügung.

## Erscheinen

- [ ] Der Hund sitzt auf der Oberkante der Claude-Promptbox (Füße genau auf der Linie).
- [ ] Er atmet/wedelt (Leerlauf-Schleife) und blinzelt alle 3–6 s.
- [ ] Gelegentlich läuft er zu einer anderen Stelle und setzt sich wieder.
- [ ] Mehrzeiliger Text (Umschalt+Enter) lässt die Box wachsen – das Tier wandert mit nach oben.
- [ ] Ein Warnbanner über der Box (z. B. Nutzungslimit) – das Tier sitzt oben auf dem Banner.
- [ ] Panel schmaler/breiter ziehen – das Tier bleibt innerhalb der Box.
- [ ] Slash-Menü (`/`) öffnen – das Tier blendet sich aus, solange das Menü darüber liegt.
- [ ] Text in der Box ist nie verdeckt, Klicks ins Eingabefeld funktionieren überall.

## Claude-Ereignisse

- [ ] Tippen → `zuschauen`, 1,5 s nach dem letzten Tastendruck zurück in den Leerlauf.
- [ ] Prompt senden → `aufmerksam`, dann `nachdenken`.
- [ ] Claude liest Dateien (Read/Grep/Glob) → `schnueffeln` (läuft langsam).
- [ ] Claude schreibt (Edit/Write) → `buddeln`.
- [ ] Websuche/WebFetch → `lauschen`.
- [ ] `npm test` → `gespannt`, danach `freuen` (grün) bzw. `traurig` (rot).
- [ ] `npm install` → `ungeduldig`; `git commit` → `nachdenken`, danach `freuen`.
- [ ] Sonstiger Bash-Befehl → `rennen`.
- [ ] Freigabe-Dialog → Tier sitzt auf der Freigabekarte und `bellen`; nach der Antwort Ende.
- [ ] Claude fertig → `freuen`, danach Leerlauf.
- [ ] Werkzeugfehler → `traurig`.
- [ ] Escape während Claude arbeitet → `ohren_anlegen`.
- [ ] Ohne Hooks (`claudePets.hooks.enabled = false`, neu laden): „Claude arbeitet“ zeigt
      trotzdem `nachdenken`, Freigabe-Dialog trotzdem `bellen`.

## Interaktionen

- [ ] Streicheln: Maus schnell hin und her über dem Tier → `streicheln` mit Herzen.
- [ ] Anstupsen: Klick → kurzes Erschrecken, dann `freuen`.
- [ ] Ruhige Maus über dem Tier bei fokussierter Promptbox → Tier wird nach 0,6 s durchscheinend.
- [ ] Knopfleiste erscheint beim Darüberfahren, verschwindet 2 s nach dem Verlassen;
      Tooltips nennen die Dinge der Tierart (Katze: Fisch, Wollknäuel, Federangel).
- [ ] Napf: Napf erscheint neben dem Tier, es läuft hin und frisst 4 s genau darüber,
      danach 2 s leerer Napf.
- [ ] Leckerli: `leckerli_fangen`.
- [ ] Spielzeug: an der Maus ziehen und werfen → fliegt mit Schwerkraft, prallt ab, rollt
      aus; das Tier lauert, rennt hinterher (überholt nie), nimmt es auf, bringt es zurück,
      setzt sich 4 s damit hin, legt es ab.
- [ ] Seil: festhalten, zum Maul ziehen → `zerrspiel` mit zweifarbiger Linie; Loslassen beendet.
- [ ] Bauch kraulen: Kontextmenü „Platz“, dann mit der Maus über dem Tier kreisen →
      rollt auf den Rücken und strampelt, solange die Maus sich bewegt; danach zurück.
- [ ] Rufen: Doppelklick knapp über der Box-Oberkante → Tier läuft hin und setzt sich.
- [ ] Kontextmenü (Rechtsklick): Sitz, Platz, Pfötchen, Drehen, Schlafen, Tier wechseln …,
      Ausblenden (bis Neuladen). Escape/Klick daneben schließt es.

## Tierwechsel

- [ ] Kontextmenü → „Tier wechseln …“ → jedes der 12 Tiere einmal wählen.
- [ ] Die Einstellung `claudePets.species` folgt der Auswahl.
- [ ] „Claude Pets: Tier wählen …“ bzw. Klick auf „🐾 …“ in der Statusleiste wechselt das
      Tier sofort (ohne Neuladen, wenn die Bridge verbunden ist).
- [ ] `zufall`: nach jedem Neuladen ein anderes Tier; die Statusleiste zeigt das aktuelle.
- [ ] Hase, Frosch, Eichhörnchen hoppeln; die Krabbe wird nie gespiegelt.

## Deaktivieren und Deinstallation

- [ ] „Claude Pets: Deaktivieren“ → Hinweis zum Neuladen; danach kein Tier, in
      `webview/index.js`, `webview/index.css` und `extension.js` von Claude Code kein
      `claude-pets`-Text mehr, in `~/.claude/settings.json` keine Claude-Pets-Hooks.
- [ ] „Claude Pets: Aktivieren“ stellt alles wieder her.
- [ ] Extension deinstallieren, VS Code neu starten → wie oben rückstandslos, zusätzlich
      `~/.claude-pets` gelöscht.
- [ ] Claude Code aktualisieren → Claude Pets patcht die neue Version und bietet Neuladen an.
