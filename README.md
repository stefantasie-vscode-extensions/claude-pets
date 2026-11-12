# Claude Pets

Ein kleines Pixel-Haustier wohnt auf der Oberkante der Eingabebox von **Claude Code** in VS Code.
Es atmet, blinzelt, wedelt, läuft herum – und reagiert auf das, was Claude gerade tut, auf
deine Eingaben und auf die Maus.

Zwölf Tiere stehen zur Wahl: Hund, Katze, Fuchs, Waschbär, Panda, Affe, Hase, Frosch, Roboter,
Krabbe, Eichhörnchen und Schildkröte. Jedes hat dieselben 49 Animationen, inhaltlich passend
(die Katze versteckt einen Fisch statt eines Knochens, der Frosch hüpft herbei …).

## Installation

1. Die Extension [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) muss installiert sein.
2. `claude-pets-0.1.1.vsix` installieren:
   `code --install-extension claude-pets-0.1.1.vsix --force`
3. Beim ersten Start richtet Claude Pets alles ein und meldet
   „Claude Pets ist bereit. Fenster neu laden, damit das Haustier erscheint.“ → **Neu laden**.

Aus dem Quellcode: `npm install`, `npm test`, `npm run build`, `npm run package`, dann `npm run install-local`.

### Wie kommt das Tier in Claude Code?

VS Code erlaubt einer Extension nicht, in die Oberfläche einer anderen zu zeichnen. Claude Pets
hängt deshalb – wie die Extension *Claude Maid* – einen klar markierten Block an die
Webview-Dateien von Claude Code an (`webview/index.js`, `webview/index.css`) und erlaubt in der
Content-Security-Policy von Claude Code (`extension.js`) Verbindungen zu `http://127.0.0.1`,
damit Hook-Ereignisse das Tier erreichen. Vor der ersten Änderung entsteht je eine Sicherung
`*.claude-pets.bak`. Nach einem Update von Claude Code wird automatisch neu gepatcht.

## Worauf das Tier reagiert

| Was passiert | Das Tier … |
| --- | --- |
| du tippst | schaut zu |
| du schickst einen Prompt ab | horcht auf, dann denkt es nach |
| Claude liest/sucht Dateien | schnüffelt herum |
| Claude schreibt Code | buddelt |
| Websuche / Webseite laden | lauscht |
| Tests laufen | ist gespannt – und freut sich oder ist traurig |
| `npm install` & Co. | wird ungeduldig |
| sonstige Befehle | rennt |
| Freigabe nötig | bellt (bzw. miaut, quakt …) |
| Claude ist fertig | freut sich |
| Fehler | ist traurig |
| du brichst mit Escape ab | legt die Ohren an |
| lange nichts los | legt sich hin und schläft ein |

Dazu Kleinigkeiten wie Gähnen beim Komprimieren, ein Knochen für jeden zurückkehrenden
Subagenten oder ein Nicken, wenn die CLAUDE.md geladen wurde.

## Interaktionen

- **Streicheln:** Maus schnell über dem Tier hin und her bewegen.
- **Anstupsen:** einmal klicken.
- **Knopfleiste:** Beim Darüberfahren erscheinen vier Knöpfe:
  - **Napf** – das Tier läuft hin und frisst.
  - **Leckerli** – wird zugeworfen und gefangen.
  - **Spielzeug** – festhalten, ziehen und loslassen: es fliegt, das Tier holt es zurück.
  - **Seil** – festhalten und zum Maul ziehen: Zerrspiel, solange du festhältst.
- **Bauch kraulen:** Wenn das Tier liegt (Kontextmenü „Platz“), mit der Maus darüber kreisen.
- **Rufen:** Doppelklick knapp über der Oberkante der Box – das Tier kommt.
- **Kontextmenü** (Rechtsklick): Sitz, Platz, Pfötchen, Drehen, Schlafen, Tier wechseln …,
  Ausblenden (bis Neuladen).
- Ruht die Maus über dem Tier, während du tippst, wird es durchscheinend.

Das Tier stört nie die Eingabe: Text in der Box wird nicht verdeckt, und Klicks ins Eingabefeld
funktionieren immer.

## Einstellungen

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| `claudePets.enabled` | `true` | Haustier anzeigen (aus = Injektion und Hooks entfernen) |
| `claudePets.species` | `hund` | Tierart oder `zufall` (bei jedem Start zufällig) |
| `claudePets.scale` | `2` | Pixelgröße 1–4 |
| `claudePets.showButtons` | `true` | Knopfleiste beim Darüberfahren |
| `claudePets.hooks.enabled` | `true` | Claude-Code-Hooks einrichten |
| `claudePets.idle.wander` | `true` | frei herumlaufen |
| `claudePets.idle.sleepAfterMinutes` | `4` | Einschlafen nach so vielen Minuten Ruhe |
| `claudePets.opacityOnHover` | `0.35` | Deckkraft bei ruhender Maus über dem Tier |
| `claudePets.reduceMotion` | `auto` | `auto` folgt dem System, `on`, `off` |
| `claudePets.patchCsp` | `true` | CSP von Claude Code für die Hook-Ereignisse erweitern |
| `claudePets.debug` | `false` | ausführliches Logging |

## Befehle

Alle unter „Claude Pets: …“ in der Befehlspalette: **Aktivieren**, **Deaktivieren**,
**Neu anwenden**, **Tier wählen …**, **Hooks installieren**, **Hooks entfernen**, **Diagnose**.
In der Statusleiste zeigt „🐾 Hund“ das aktuelle Tier; ein Klick öffnet die Auswahl.

## Datenschutz

- Claude Pets richtet in `~/.claude/settings.json` asynchrone Hooks ein. Sie laufen im
  Hintergrund und bremsen Claude nicht. Das Hook-Script schreibt nichts in die Ausgabe und
  endet immer erfolgreich.
- Das Script schickt nur ein verschlanktes Ereignis an einen lokalen Server der Extension
  (`127.0.0.1`, Ports 47811–47830, geschützt durch ein zufälliges Token). Prompts,
  Dateiinhalte und Ausgaben von Befehlen verlassen den Hook-Prozess nicht.
- Beim Tier kommen nur an: Name des Ereignisses, Werkzeugname, eine Befehlskategorie
  (Test, Installation, Commit, sonstiges), Erfolg/Misserfolg, Benachrichtigungstyp und ein
  kurzer, nicht umkehrbarer Hash der Sitzungs-ID (damit jedes Tier nur auf seine eigene
  Sitzung reagiert).
- Der Text in der Eingabebox wird nie gelesen – nur, *dass* getippt wird.
- Es geht nichts ins Internet. Auf die Platte geschrieben wird nur bei `claudePets.debug`
  (`~/.claude-pets/debug.log`), sonst lediglich die Instanzliste `~/.claude-pets/instances/`.

## Deinstallation

- **Vorübergehend:** „Claude Pets: Deaktivieren“ entfernt die Blöcke aus Claude Code, die
  CSP-Ergänzung und die Hooks. Danach das Fenster neu laden.
- **Vollständig:** Extension deinstallieren und VS Code neu starten. Das Deinstallations-Script
  entfernt dann in allen installierten Claude-Code-Versionen die Änderungen, die Hooks und
  `~/.claude-pets`. Es bleibt nur die Sicherung `~/.claude/settings.json.claude-pets.bak`.

Weitere Hintergründe: [docs/ENTSCHEIDUNGEN.md](https://git.kleywalker.de/vscode/claude-pets/src/branch/main/docs/ENTSCHEIDUNGEN.md),
manuelle Prüfliste: [docs/TESTPLAN.md](https://git.kleywalker.de/vscode/claude-pets/src/branch/main/docs/TESTPLAN.md).

## Lizenz

MIT © Stefan Kley
