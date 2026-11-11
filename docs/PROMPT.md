# Übergabe: VS-Code-Extension „Claude Pets“

Du baust eigenständig eine fertige VS-Code-Extension, pushst sie in ein Git-Repository und installierst sie lokal. Alle Grafiken liegen in diesem Paket. Lies dieses Dokument vollständig, bevor du anfängst. Arbeite ohne Rückfragen durch. Wenn etwas nicht wie beschrieben funktioniert, wähle die robusteste Alternative, dokumentiere die Entscheidung in `docs/ENTSCHEIDUNGEN.md` und mach weiter. Nur wenn etwas Zerstörerisches oder Unumkehrbares nötig wäre, hältst du an und fragst.

---

## 1. Ziel

Ein kleines Pixel-Haustier sitzt auf der Oberkante der Eingabebox (Promptbox) der **Claude-Code-Extension** in VS Code. Es lebt dort, bewegt sich frei, atmet, blinzelt, wedelt und reagiert:

- auf **Claude-Code-Ereignisse** (Hooks), z. B. Claude denkt, liest Dateien, schreibt Code, braucht eine Freigabe, ist fertig, Fehler;
- auf **Vorgänge in der Claude-Oberfläche**, z. B. du tippst, Escape bricht ab;
- auf **Interaktionen mit der Maus**, z. B. streicheln, füttern, Spielzeug werfen, Zerrspiel, Bauch kraulen, Tricks.

Es gibt 12 Tierarten mit je denselben 49 Animationen. Die Inhalte sind pro Tier angepasst, z. B. Fisch statt Knochen bei der Katze.

Fertig heißt: Das Repo ist gepusht, die `.vsix` ist gebaut und installiert, und nach einem Neuladen von VS Code sitzt der Hund auf der Claude-Promptbox (siehe Abschnitt 12).

---

## 2. Rahmendaten

| Was | Wert |
|---|---|
| Repository | `git@git.kleywalker.de:vscode/claude-pets.git` (leer, Zugriff per SSH, Branch `main`) |
| Extension-Name | `claude-pets` |
| Anzeigename | `Claude Pets` |
| Publisher | `kleywalker` |
| Startversion | `0.1.0` |
| Sprache der Oberfläche | Deutsch (alle Texte, Befehle, Einstellungen, README) |
| Sprache im Code | TypeScript (strict), Kommentare auf Deutsch oder Englisch |
| Ziel-Plattform | macOS zuerst, Pfade aber plattformunabhängig (Windows/Linux sollen nicht kaputtgehen) |
| VS Code | `engines.vscode: ^1.90.0` |
| Laufzeit-Abhängigkeiten | keine (nur Dev-Dependencies) |
| Build | esbuild |
| Tests | vitest |
| Paketierung | `@vscode/vsce` |
| Lizenz | MIT, Copyright Stefan Kley |

---

## 3. Inhalt dieses Pakets

```
PROMPT.md               ← dieses Dokument
triggers.json           ← Zuordnung Ereignis → Animation, Prioritäten, Leerlauf, Interaktionen
assets/
  icon.png              ← Extension-Icon (128×128), unverändert verwenden
  01_hund/              02_katze/  03_fuchs/  04_waschbaer/  05_panda/  06_affe/
  07_hase/  08_frosch/  09_roboter/  10_krabbe/  11_eichhoernchen/  12_schildkroete/
    atlas.png           ← Spritesheet: alle Frames, 24×24 px je Frame, 16 pro Zeile
    atlas.json          ← Metadaten (Schema unten)
    objects.png         ← Einzelobjekte für Interaktionen (Spielzeug, Leckerli, Napf …)
```

Alles wird ins Repo unter `assets/` übernommen. Die Ordnernamen bleiben gleich, die Datei-IDs auch.

### 3.1 Schema `atlas.json`

```jsonc
{
  "species": { "id": "katze", "label": "Katze", "item": "Fisch", "toy": "Wollknäuel",
               "rope": "Federangel", "sound": "miauen", "gait": "walk" },  // gait: "walk" | "hop"
  "frameSize": 24,
  "scale": 2,                       // empfohlene Darstellungsgröße (1 Pixel = 2 CSS-Pixel)
  "poses": { "sit": "...", "stand": "...", "lie": "...", "belly": "..." },
  "anchor": { "facing": "right", "groundRow": 22 },
  "animations": {
    "<kanonische_id>": {
      "label": "fisch verstecken",  // Anzeigename dieser Tierart
      "frames": ["knochen_vergraben_1", "..."],
      "fps": 8,
      "loop": false,
      "group": "Neu",
      "note": "TaskCreated: neue Aufgabe angelegt.",
      "pose": ["stand", "stand"],   // Pose im ersten und im letzten Frame
      "eyes": {                     // nur bei sitzen, stehen, liegen, mit_ball_sitzen
        "half":   ["sitzen_1_half", "..."],
        "closed": ["sitzen_1_closed", "..."]
      }
    }
  },
  "frames":  { "<frame_name>": { "x": 0, "y": 0, "w": 24, "h": 24 } },
  "objects": {
    "toy": {"x":0,"y":0,"w":4,"h":4}, "treat": {...}, "item": {...},
    "bowl_full": {...}, "bowl_empty": {...}, "heart": {...}, "heart_small": {...},
    "rope_icon": {...},
    "rope_colors": ["#rrggbb", "#rrggbb"]
  }
}
```

Wichtige Fakten zu den Grafiken:

- **Kanonische IDs** sind bei allen 12 Tieren identisch (49 Stück, ASCII, z. B. `knochen_vergraben`, `schnueffeln`, `gaehnen`). Der Code spricht Animationen immer über diese IDs an. Was ein Tier dabei konkret tut, steht in `label`. Die Katze zeigt bei `knochen_vergraben` also „fisch verstecken“.
- **Alle Seitenansichten schauen nach rechts.** Nach links laufen heißt horizontal spiegeln. Frontansichten (`pose` = `sit`) werden nie gespiegelt.
- **Fußlinie:** Die unterste Reihe der Füße ist Pixelreihe 22, Reihe 23 ist leer. Diese Reihe 22 liegt direkt auf der Oberkante der Promptbox.
- **Effekte sind eingebacken:** Herzen, Z beim Schlafen, „!“, „?“, Gedankenblase, Schall-Linien, Napf beim Fressen, Keks beim Leckerli, Erde beim Buddeln. Das Leckerli muss also nicht separat animiert werden, sondern `leckerli_fangen` wird einfach abgespielt.
- **Atmen und Wedeln** stecken in den Leerlauf-Schleifen. Die Animation `blinzeln_sitzen` ist nur eine Referenz und wird nicht direkt abgespielt. **Blinzeln** passiert zur Laufzeit: Zum aktuellen Frame-Index der Leerlauf-Animation den gleichnamigen Frame aus `eyes.half` bzw. `eyes.closed` zeigen. Ablauf: half → closed → half, je 80 ms, zufällig alle 3–6 s.
- **Rückwärts abspielen** ergibt Übergänge: `umdrehen` geht von Sitzen (vorne) zu Stehen (Seite), `umdrehen:reverse` umgekehrt. `hinlegen:reverse` ist Aufstehen, `auf_den_ruecken_rollen:reverse` ist zurück in die Liegeposition.
- **Krabbe:** Ihre Frames sind alle Frontansicht (`pose` überwiegend `sit`). Spiegeln schadet nicht, Übergänge sind dann einfach kurze Animationen ohne Blickwechsel.
- **Frosch:** hat keinen Schwanz. **Hase, Frosch, Eichhörnchen:** `gait: "hop"`, d. h. sie hoppeln. Für die Logik spielt das keine Rolle, nur für die Laufgeschwindigkeit (siehe 6.4).

### 3.2 `triggers.json`

Diese Datei ist die **Quelle der Wahrheit** für das Verhalten. Lies sie zur Build-Zeit ein (bündeln) und setze sie vollständig um. Notation:

- `play`: Liste von Einmal-Animationen nacheinander.
- `while`: Schleife bis zum nächsten passenden Ereignis.
- `then`: Folgezustand. `idle` heißt Leerlauf nach Abschnitt `idle`.
- `name:reverse`: rückwärts abspielen.
- `name:2-3`: nur Frames 2 bis 3 (1-basiert).
- `priority`: verweist auf `priorities`. Höhere Priorität unterbricht niedrigere, bei gleicher gewinnt die neuere. Einmal-Animationen laufen zu Ende, wenn nichts Höheres kommt.

Dazu kommen Sonderfälle in `triggers.json`:

- **PreToolUse** wird über `tool_name` unterschieden, Bash-Befehle zusätzlich über reguläre Ausdrücke auf `tool_input.command`. Der Tag aus dem Treffer (`test`, `install`, `commit`, `bash`) wird bis zum zugehörigen PostToolUse gemerkt.
- **PostToolUse** spielt nach `test`/`commit` je nach Erfolg `freuen` oder `traurig`. Erfolg bestimmst du aus dem Hook-Payload: Exit-Code bzw. Fehlerfeld in `tool_response`. Prüfe das reale Payload-Format in der Doku (siehe 5.2) und gib im Zweifel `freuen` nur bei eindeutigem Erfolg.

---

## 4. Wie das Tier in die Claude-Oberfläche kommt (Injektion)

Eine VS-Code-Extension kann normalerweise nicht in den Webview einer anderen Extension zeichnen. Die Extension **Claude Maid** (`nicoyou.claude-maid`) löst das so: Sie hängt eigenes CSS und JS mit Markierungs-Kommentaren an die Webview-Dateien der Claude-Code-Extension an (laut ihrer Beschreibung `webview/index.css` und `webview/index.js`). Nach Updates von Claude Code platziert sie alles automatisch neu. **Genau so machen wir es auch.**

### 4.1 Claude-Code-Extension finden

1. Über `vscode.extensions.all` die Extension suchen, deren ID `anthropic.claude-code` ist (Groß/Klein ignorieren). Ist sie nicht installiert: Hinweis mit Button „Claude Code installieren“, der den Marketplace öffnet, dann nichts weiter tun.
2. Im `extensionPath` die Webview-Dateien **selbst nachsehen**, statt Namen zu raten. Erwartet werden `webview/index.js` und `webview/index.css`. Liegen sie anders, per Suche nach `.js`/`.css` im Webview-Ordner und nach der Stelle in der Extension, die das Webview-HTML baut, die richtigen Dateien bestimmen. Schreibe das Ergebnis in `docs/ENTSCHEIDUNGEN.md`.
3. Die gefundene Claude-Version und die Pfade in einer Diagnose-Ausgabe anzeigen (Befehl, siehe 8).

### 4.2 Patchen

- **Format:** Am Ende von `index.js` einen Block anhängen:
  ```
  /* claude-pets:start v<extVersion> */
  ;(function(){ try { … gebündeltes Webview-Script … } catch (e) { console.warn('[claude-pets]', e); } })();
  /* claude-pets:end */
  ```
  Analog dazu am Ende von `index.css` einen CSS-Block mit `/* claude-pets:start */ … /* claude-pets:end */`.
- **Idempotent:** Vor dem Anhängen immer einen bestehenden Block entfernen. Mehrfaches Anwenden darf die Datei nicht wachsen lassen.
- **Sicherheit:**
  - Vor dem ersten Patch eine Sicherung `index.js.claude-pets.bak` (bzw. `.css`) anlegen, falls noch keine existiert.
  - Atomar schreiben, also in eine temporäre Datei, dann umbenennen.
  - Nur diese zwei Dateien anfassen.
  - Bei jedem Fehler: nichts kaputtmachen, Fehler im Output-Channel „Claude Pets“ loggen, Hinweis anzeigen.
- **Grafiken einbetten:** Der Webview darf nur Ressourcen aus erlaubten Pfaden laden. Deshalb alle 12 `atlas.png` und `objects.png` als Base64-Data-URL sowie alle `atlas.json` (kompakt, ohne Leerzeichen) und `triggers.json` direkt in das eingeschleuste Script bündeln, zusammen ca. 1 MB. So kann das Tier im Webview ohne Neuladen gewechselt werden.
- **Konfiguration einbetten:** Die aktuellen Einstellungen (Abschnitt 7) und die Bridge-Daten (Ports, Token, siehe 5.3) beim Patchen als JSON-Objekt mit einbetten. Ändern sich Einstellungen, neu patchen und Neuladen anbieten.
- **Wann patchen:**
  - beim Aktivieren (`onStartupFinished`), wenn der Block fehlt oder eine andere Version hat;
  - nach Updates von Claude Code (`vscode.extensions.onDidChange` und Abgleich beim Start);
  - bei Einstellungsänderungen;
  - über den Befehl „Neu anwenden“.
  
  Nach einem Patch eine Benachrichtigung zeigen: „Claude Pets ist bereit. Fenster neu laden, damit das Haustier erscheint.“ mit Button „Neu laden“ (`workbench.action.reloadWindow`).
- **Entfernen:**
  - Befehl „Deaktivieren“ entfernt die Blöcke (aus der Sicherung wiederherstellen ist nicht nötig, der Block wird herausgeschnitten).
  - Zusätzlich ein `vscode:uninstall`-Script in `package.json` (`node ./dist/uninstall.js`). Es entfernt beim Deinstallieren die Blöcke in allen gefundenen Claude-Code-Versionen sowie die Hooks (5.4).

### 4.3 Content-Security-Policy prüfen

Für die Hook-Ereignisse muss das eingeschleuste Script per `fetch`/`EventSource` mit `http://127.0.0.1:<port>` sprechen.

1. Finde heraus, welche CSP Claude Code für seinen Webview setzt. Suche im Extension-Code nach `Content-Security-Policy` bzw. `connect-src`.
2. Erlaubt sie die Verbindung, ist alles gut.
3. Erlaubt sie sie nicht, gibt es zwei Wege:
   - **Variante A, bevorzugt, wenn sauber machbar:** Die CSP-Zeichenkette minimal um `http://127.0.0.1:*` in `connect-src` ergänzen. Das geht ebenfalls mit Markierung, Sicherung, idempotent und wieder entfernbar. Die Einstellung `claudePets.patchCsp` (Standard `true`) schaltet das ab.
   - **Variante B, Fallback:** reiner DOM-Modus (siehe 6.6). Hooks werden dann nicht ins Tier geliefert, alles andere funktioniert.
4. Die gewählte Variante in `docs/ENTSCHEIDUNGEN.md` begründen und im Diagnose-Befehl anzeigen.

---

## 5. Claude-Code-Ereignisse (Hooks-Bridge)

### 5.1 Übersicht

```
Claude Code ──(Hook, async)──► node dist/hook.js ──HTTP POST──► Extension-Host (127.0.0.1)
                                                                    │
                                     Webview-Script ◄──EventSource──┘
```

### 5.2 Fakten zu Hooks

Prüfe alle Details in der offiziellen Doku: https://code.claude.com/docs/en/hooks (Payload-Felder, Matcher, `async`).

Bekannte Eckdaten:

- Hooks stehen in `~/.claude/settings.json` unter `hooks`. Command-Hooks können `"async": true` setzen und laufen dann im Hintergrund, ohne Claude zu blockieren.
- Die Hook-Eingabe kommt als JSON über stdin. Sie enthält u. a. den Event-Namen und je nach Event Felder wie `tool_name`, `tool_input`, `tool_response`, `cwd`, `session_id`.
- Notification-Matcher `agent_needs_input` und `agent_completed` gibt es ab Claude Code v2.1.198.
- Ein Tastendruck-Event gibt es **nicht**. Tippen wird im DOM erkannt (6.6).
- Es gab Berichte, dass einzelne Hooks (z. B. `Stop`, `Notification`) in der VS-Code-Extension nicht immer auslösen. Deshalb gibt es DOM-Fallbacks für „Claude arbeitet“ und „Freigabe-Dialog sichtbar“.

### 5.3 Bridge im Extension-Host

- HTTP-Server auf `127.0.0.1`. Er bindet den **ersten freien Port im Bereich 47811–47830**, damit das Webview-Script die Ports durchprobieren kann.
- Ein zufälliges Token wird einmalig erzeugt und in `globalState` gespeichert. Jede Anfrage muss es mitschicken. Ohne Token gibt es 403.
- Endpunkte:
  - `POST /event`: nimmt ein Hook-Payload an, filtert es und verteilt es an alle SSE-Clients.
  - `GET /events?token=…`: Server-Sent Events für das Webview-Script.
  - `GET /hello?token=…`: liefert `{ ok: true, workspaceFolders, version }`.
- **Mehrere VS-Code-Fenster:** Jedes Fenster hat seinen eigenen Server. Registrierung in `~/.claude-pets/instances/<pid>.json` mit `{ port, workspaceFolders, startedAt }`, beim Beenden löschen, verwaiste Einträge beim Start aufräumen. Das Webview-Script verbindet sich mit dem Port, dessen `workspaceFolders` zu seinem Fenster passen. Ist das nicht bestimmbar, mit allen erreichbaren Ports.
- **Datenschutz:** An das Webview werden nur die Felder weitergegeben, die zur Entscheidung nötig sind: Event-Name, `tool_name`, Bash-Tag (vorab im Host berechnet), Erfolg/Misserfolg und Notification-Typ. **Keine** Prompt-Inhalte, Dateiinhalte oder Befehle. Nichts wird auf Platte geloggt, außer `claudePets.debug` ist an.

### 5.4 Hook-Script und Installation in `~/.claude/settings.json`

- `dist/hook.js` ist ein eigenständiges Node-Script ohne Abhängigkeiten. Es
  1. liest stdin,
  2. liest die Instanz-Dateien,
  3. sendet das Payload per POST an die passenden Instanzen (gleicher `cwd` oder darunter, sonst an alle; Timeout 300 ms),
  4. **schreibt nichts nach stdout/stderr** (stdout kann bei manchen Events Claude beeinflussen),
  5. beendet sich immer mit Exit-Code 0.
- **Installation beim ersten Start, automatisch:**
  - Eine Sicherung `~/.claude/settings.json.claude-pets.bak` anlegen.
  - Für jedes Event aus `triggers.json → hooks` einen Eintrag ergänzen:
    `{"type":"command","command":"node \"<absoluter Pfad>/dist/hook.js\"","async":true}`.
  - Die Datei vorsichtig zusammenführen: Fremde Hooks bleiben unangetastet. Eigene Einträge werden am Pfadbestandteil `claude-pets` erkannt und bei neuer Extension-Version (neuer Pfad) ersetzt statt verdoppelt.
  - Existiert die Datei nicht, wird sie angelegt.
  - Danach Hinweis: „Claude-Pets-Hooks wurden eingerichtet.“ mit Button „Rückgängig“.
- Befehle „Hooks installieren“ und „Hooks entfernen“. Die Einstellung `claudePets.hooks.enabled` schaltet die Hooks dauerhaft ab und entfernt sie.
- Ob ein Event-Name in der installierten Claude-Version existiert, ist egal. Unbekannte Events schaden nicht. Die Liste kommt aus `triggers.json`.

---

## 6. Das Haustier im Webview

Quellcode unter `src/webview/`, gebündelt als IIFE und in `index.js` eingeschleust (4.2). Kein Framework, reines TypeScript plus DOM/Canvas.

### 6.1 Einhängen

- Das Eingabefeld der Claude-Oberfläche finden: Textarea bzw. contenteditable der Promptbox, dann der nächste umschließende Container mit sichtbarer Umrandung. Ermittle robuste Selektoren, indem du das Webview-Bundle bzw. DOM untersuchst (Rollen, aria-Attribute, Platzhaltertext, Struktur). Alle Selektoren gehören in ein Modul `selectors.ts` mit mehreren Fallbacks.
- Ein Overlay `#claude-pets-root` absolut positioniert anlegen, ausgerichtet an der Oberkante dieses Containers, mit voller Containerbreite.
  - `pointer-events: none` für das Overlay.
  - `pointer-events: auto` nur für das Tier selbst, seine Buttons, das Kontextmenü und einen 8 CSS-px hohen Streifen direkt über der Oberkante (für „Rufen“).
- Der Text in der Promptbox darf **nie** verdeckt oder blockiert werden, und Klicks ins Eingabefeld müssen immer funktionieren.
- `MutationObserver`: Rendert Claude die Box neu, das Overlay automatisch neu einhängen. `ResizeObserver`: auf Breitenänderungen reagieren und das Tier im Rahmen halten.
- Ist der Tab bzw. das Dokument unsichtbar, die Animation pausieren (`document.hidden`).

### 6.2 Darstellung

- Ein `<canvas>` von 24×24 Pixeln, per CSS skaliert auf `24 × scale` mit `image-rendering: pixelated`. Gezeichnet wird mit `drawImage(atlas, x, y, 24, 24, 0, 0, 24, 24)`. Die Atlas-Bilder einmal dekodieren und dann nur noch Ausschnitte zeichnen, so wechseln Frames ohne Verzögerung.
- Unterkante des Canvas so setzen, dass Pixelreihe 22 auf der Oberkante der Box liegt: `bottom = Containeroberkante − 1 × scale`.
- Spiegeln für Laufen nach links per `transform: scaleX(-1)`, nur bei Posen `stand`, `lie` und `belly`.
- Objekte aus `objects.png` (Napf, Spielzeug, Leckerli, Herzen, Buttons) jeweils als eigene kleine Canvas-Elemente in derselben Skalierung.
- **Transparenz:** Steht der Mauszeiger über dem Tier, während die Promptbox fokussiert ist und die Maus 600 ms ruht, Deckkraft auf `claudePets.opacityOnHover` (Standard 0.35) setzen, damit Text dahinter lesbar bleibt. Bewegt sich die Maus, wieder normal (das ist Streicheln, siehe 6.7).

### 6.3 Animations-Engine

- Zeitbasiert über `requestAnimationFrame`, mit `fps` aus `atlas.json`. Unterstützt Schleife, einmal, `:reverse` und `:a-b`.
- **Warteschlange mit Prioritäten** aus `triggers.json`.
- **Posen-Graph** mit automatischen Übergängen. Hat eine angeforderte Animation eine andere Start-Pose als die aktuelle End-Pose, wird vorher der kürzeste Übergang eingefügt (Breitensuche):
  - `sit → stand`: `umdrehen`, umgekehrt `umdrehen:reverse`
  - `stand → lie`: `hinlegen`, umgekehrt `hinlegen:reverse`
  - `lie → belly`: `auf_den_ruecken_rollen`, umgekehrt `auf_den_ruecken_rollen:reverse`
  
  Bei Gleichstand der Posen wird nichts eingefügt.
- **Blinzeln** wie in 3.1 beschrieben, nur in Animationen mit `eyes`.
- **Bewegung:** Laufanimationen verschieben die x-Position pro Frame:
  - `gehen`, `mit_ball_gehen`, `knochen_bringen`: 1 Atlas-Pixel pro Frame
  - `rennen`: 3 Pixel pro Frame
  - `schnueffeln`: 0,5 Pixel pro Frame
  - bei `gait: "hop"` nur in den Frames, in denen das Tier in der Luft ist, dafür doppelt so weit
  
  Grenzen sind die Containerbreite minus Tierbreite. Am Rand umdrehen.
- `prefers-reduced-motion` bzw. die Einstellung `claudePets.reduceMotion` schalten freies Herumlaufen und Zufallsaktionen ab. Reaktionen auf Ereignisse bleiben.

### 6.4 Leerlauf

Leerlauf nach `triggers.json → idle`:

- Grundpose `sitzen`, dazu Blinzeln.
- Gelegentlich zu einer zufälligen Stelle laufen.
- Selten eine Zufallsaktion.
- Nach `lieDownAfterMs` hinlegen, nach `sleepAfterMs` einschlafen. Jede Aktivität (Hook, Tippen, Maus am Tier) weckt das Tier mit der Sequenz `wakeUp`.

### 6.5 Hook-Ereignisse

- Das Webview-Script probiert die Ports 47811–47830 mit `GET /hello` durch, wählt nach `workspaceFolders` aus und öffnet `EventSource('/events?token=…')`. Bei Abbruch neu verbinden (exponentiell bis max. 30 s).
- Ereignisse werden nach `triggers.json → hooks` in Animationen übersetzt.
- `while`-Zustände enden beim nächsten passenden Ereignis, spätestens nach 60 s ohne neues Ereignis. Danach `idle`.

### 6.6 DOM-Erkennung

Gilt immer, ist aber auch der Fallback ohne Hooks:

- **Tippen:** `input`-Ereignisse im Eingabefeld zählen, solange tippen = `zuschauen`, 1,5 s nach dem letzten Tastendruck vorbei. **Niemals den Text lesen oder weitergeben.**
- **Escape** während Claude arbeitet: `ohren_anlegen`.
- **Claude arbeitet:** Ein Stopp-Button bzw. Ladeanzeige ist sichtbar. Dann `nachdenken`, wenn kein spezifischeres Hook-Ereignis aktiv ist.
- **Freigabe-Dialog sichtbar:** `bellen`.
- Die Selektoren dafür ermittelst du am echten Webview und dokumentierst sie in `selectors.ts`. Wird ein Selektor nicht gefunden, fällt das Merkmal still weg.

### 6.7 Interaktionen

Umsetzung nach `triggers.json → interactions`:

- **Streicheln:** Die Maus bewegt sich über dem Tier, mindestens 3 Richtungswechsel innerhalb 1 s. Dann `streicheln`, solange die Bewegung anhält.
- **Anstupsen:** Klick auf das Tier spielt `erschrecken:2-3`, dann `freuen`.
- **Buttons:** Beim Hover über dem Tier erscheint darüber eine kleine Leiste mit 4 Symbolen aus `objects.png`: Napf (`bowl_full`), Leckerli (`treat`), Spielzeug (`toy`), Seil (`rope_icon`). Tooltips nutzen die Tiernamen aus `species`, z. B. „Fisch“, „Wollknäuel“, „Federangel“. Die Leiste verschwindet 2 s nach Verlassen. Abschaltbar über `claudePets.showButtons`.
  - **Napf:** Der Napf erscheint auf der Box rechts vom Tier, das Tier läuft hin. Ziel-x ist so gewählt, dass der eingebackene Napf in `fressen` (Sprite-x 17–23, Reihen 20–22) genau auf dem gezeigten Napf liegt. Während `fressen` den separaten Napf ausblenden. `fressen` 4 s lang wiederholen, danach 2 s `bowl_empty` anzeigen und ausblenden.
  - **Leckerli:** `leckerli_fangen` abspielen. Der Keks ist eingebacken.
  - **Spielzeug:** Das Spielzeug klebt am Mauszeiger, bis losgelassen wird. Die Wurfgeschwindigkeit ergibt sich aus der Mausbewegung der letzten 100 ms. Physik:
    - Schwerkraft 0,7 Atlas-px/Frame² bei 10 Hz;
    - Aufprall auf der Box-Oberkante mit Faktor 0,45 auf vy und 0,75 auf vx;
    - auf dem Boden Reibung 0,8 pro Frame, Stopp unter 0,3;
    - innerhalb der Containerbreite halten.
    
    Ablauf: `ball_lauern` → `rennen` (das Tier überholt das Spielzeug nie) → bei liegendem Spielzeug aufnehmen (letzte Frames von `ball_fangen`) → `mit_ball_gehen` zurück zur Startposition (gespiegelt) → `umdrehen:reverse` → `mit_ball_sitzen` 4 s → Spielzeug ablegen und ausblenden.
  - **Seil:** Das Seil hängt am Zeiger. In die Nähe des Mauls ziehen, dann `zerrspiel`. Solange die Maustaste gehalten wird, eine Linie vom Maul zum Zeiger in den beiden `rope_colors` zeichnen. Maul-Punkt: Sprite-x 23, Reihe 13 bezogen auf den Frame, gespiegelt entsprechend. Loslassen beendet das Spiel.
- **Bauch kraulen:** Die Maus kreist über dem liegenden Tier (Winkel-Summe der Bewegung über 360° innerhalb 1,5 s). Dann `auf_den_ruecken_rollen` und weiter `bauch_kraulen`, solange die Maus sich bewegt. Danach zurückrollen.
- **Rufen:** Doppelklick auf den 8-px-Streifen über der Box. Das Tier läuft zu dieser Stelle und setzt sich.
- **Kontextmenü** (Rechtsklick auf das Tier): eigenes kleines Menü im Stil von VS Code, mit den Einträgen aus `contextMenu` und einem Untermenü „Tier wechseln …“ mit allen 12 Tieren (Namen aus `species.label`). Dazu ein Eintrag „Ausblenden (bis Neuladen)“. Die Tierwahl im Webview in `localStorage` merken (in `try/catch`) und zusätzlich über die Bridge (`POST /species`) an die Extension melden. Die setzt dann `claudePets.species`.
- Keine Interaktion darf Eingaben in der Promptbox stören: kein `preventDefault` außerhalb der eigenen Elemente und kein Fokus-Klau.

---

## 7. Einstellungen (`contributes.configuration`)

| Schlüssel | Typ | Standard | Beschreibung |
|---|---|---|---|
| `claudePets.enabled` | boolean | `true` | Haustier anzeigen (aus = Injektion entfernen) |
| `claudePets.species` | enum | `"hund"` | `hund`, `katze`, `fuchs`, `waschbaer`, `panda`, `affe`, `hase`, `frosch`, `roboter`, `krabbe`, `eichhoernchen`, `schildkroete`, `zufall` (bei jedem Start zufällig) |
| `claudePets.scale` | number 1–4 | `2` | Pixelgröße |
| `claudePets.showButtons` | boolean | `true` | Napf/Leckerli/Spielzeug/Seil beim Hover |
| `claudePets.hooks.enabled` | boolean | `true` | Claude-Code-Hooks einrichten |
| `claudePets.idle.wander` | boolean | `true` | Frei herumlaufen |
| `claudePets.idle.sleepAfterMinutes` | number | `4` | Einschlafen nach Inaktivität |
| `claudePets.opacityOnHover` | number 0–1 | `0.35` | Deckkraft beim Darüberfahren mit ruhender Maus |
| `claudePets.reduceMotion` | enum | `"auto"` | `auto` folgt dem System, `on`, `off` |
| `claudePets.patchCsp` | boolean | `true` | CSP von Claude Code für die Bridge erweitern, falls nötig |
| `claudePets.debug` | boolean | `false` | Ausführliches Logging |

---

## 8. Befehle (`contributes.commands`, Kategorie „Claude Pets“)

- **Aktivieren** und **Deaktivieren** (Deaktivieren entfernt die Injektion)
- **Neu anwenden**
- **Tier wählen …** (QuickPick mit allen 12 Tieren)
- **Hooks installieren** und **Hooks entfernen**
- **Diagnose:** zeigt im Output-Channel:
  - Claude-Code-Version und gepatchte Dateien
  - Patch-Status und CSP-Ergebnis
  - Hook-Status in `settings.json`
  - Bridge-Port und verbundene Webview-Clients
  - Anzahl empfangener Events
- **Status-Leiste:** ein Eintrag „🐾 <Tiername>“. Ein Klick öffnet „Tier wählen …“.

---

## 9. Projektaufbau

```
.
├─ assets/                 (aus dem Paket, unverändert)
├─ triggers.json           (aus dem Paket, unverändert)
├─ src/
│  ├─ extension.ts         Aktivierung, Befehle, Einstellungen, Status-Leiste
│  ├─ claudeLocator.ts     Claude-Code-Extension + Webview-Dateien finden
│  ├─ injector.ts          Patchen/Entfernen (rein, gut testbar)
│  ├─ csp.ts               CSP prüfen/erweitern
│  ├─ bridge.ts            HTTP/SSE-Server, Instanz-Registrierung
│  ├─ hooksInstaller.ts    ~/.claude/settings.json zusammenführen/entfernen
│  ├─ hook.ts              → dist/hook.js (stdin → POST, Exit 0, keine Ausgabe)
│  ├─ uninstall.ts         → dist/uninstall.js
│  └─ webview/
│     ├─ main.ts           Einstieg (IIFE)
│     ├─ selectors.ts      DOM-Selektoren mit Fallbacks
│     ├─ mount.ts          Overlay einhängen, Observer
│     ├─ atlas.ts          Laden/Dekodieren, Frame-Zugriff
│     ├─ engine.ts         Animations-Engine, Posen-Graph, Prioritäten
│     ├─ behavior.ts       triggers.json → Verhalten, Leerlauf
│     ├─ bridgeClient.ts   Port-Suche, EventSource
│     ├─ domSignals.ts     Tippen, Escape, Busy, Freigabe-Dialog
│     ├─ interactions.ts   Maus, Buttons, Physik, Kontextmenü
│     └─ styles.css
├─ scripts/build.mjs       esbuild: Extension, Webview-Bundle (Assets als Data-URL), Hook, Uninstall
├─ test/                   vitest
├─ docs/ENTSCHEIDUNGEN.md
├─ README.md               Deutsch: Was es ist, Installation, Interaktionen, Einstellungen, Datenschutz, Deinstallation
├─ CHANGELOG.md
├─ LICENSE
├─ .vscodeignore           nur dist/, assets/icon.png, README, CHANGELOG, LICENSE, package.json ins Paket
└─ package.json
```

`package.json` (Auszug, sinngemäß):

```jsonc
{
  "name": "claude-pets", "displayName": "Claude Pets", "publisher": "kleywalker",
  "version": "0.1.0", "description": "Ein Pixel-Haustier auf der Claude-Code-Promptbox, das auf Claude reagiert.",
  "icon": "assets/icon.png", "license": "MIT",
  "repository": { "type": "git", "url": "git@git.kleywalker.de:vscode/claude-pets.git" },
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "extensionDependencies": [],          // keine harte Abhängigkeit, damit die Installation nie scheitert
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "package": "vsce package --no-dependencies",
    "install-local": "code --install-extension claude-pets-0.1.0.vsix --force",
    "vscode:prepublish": "npm run build",
    "vscode:uninstall": "node ./dist/uninstall.js"
  }
}
```

---

## 10. Tests

Mindestens diese automatischen Tests (vitest):

1. **injector:** Anhängen, erneut anhängen (keine Verdopplung), Entfernen, Versionswechsel, Datei ohne abschließenden Zeilenumbruch, Fehler beim Schreiben (Original bleibt).
2. **hooksInstaller:**
   - leere Datei bzw. fehlende Datei;
   - fremde Hooks bleiben erhalten;
   - eigene Einträge werden ersetzt statt verdoppelt;
   - Entfernen lässt fremde Hooks stehen;
   - ungültiges JSON: nicht überschreiben, Fehler melden.
3. **engine:** fps-Zeitsteuerung, Schleife, einmal, reverse, Frame-Bereiche, Prioritäten und Unterbrechung, Posen-Übergänge (z. B. von `lie` zu `sit` wird `hinlegen:reverse` + `umdrehen:reverse` eingefügt).
4. **behavior:** Tool- und Bash-Zuordnung (Test-, Install-, Commit-Erkennung) und PostToolUse-Erfolg/-Misserfolg.
5. **assets:** Alle 12 `atlas.json` enthalten dieselben 49 IDs, alle referenzierten Frames existieren, alle IDs aus `triggers.json` existieren.
6. **hook.ts:** keine Ausgabe auf stdout/stderr, Exit-Code 0 auch ohne laufenden Server.

Zusätzlich eine manuelle Prüfliste in `docs/TESTPLAN.md`: Erscheinen, Tippen, Prompt senden, Datei lesen/schreiben lassen, Freigabe-Dialog, fertig, Fehler, alle Interaktionen, Tierwechsel, Deaktivieren und Deinstallation.

---

## 11. Ablauf für dich

1. Voraussetzungen prüfen: `git`, `node` (≥ 20), `npm`, die `code`-CLI. Auf macOS ggf. `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`. Die Claude-Code-Extension sollte installiert sein.
2. Repo klonen: `git clone git@git.kleywalker.de:vscode/claude-pets.git` und Branch `main` anlegen.
3. Paketinhalt übernehmen (`assets/`, `triggers.json`). Dieses Dokument als `docs/PROMPT.md` ablegen.
4. Gerüst, Build und Tests aufsetzen. Erster Commit.
5. Die Claude-Code-Extension untersuchen: Webview-Dateien, CSP, DOM-Struktur bzw. Selektoren. Ergebnisse in `docs/ENTSCHEIDUNGEN.md`.
6. Umsetzen in sinnvollen Schritten mit je eigenem Commit:
   1. Injektion mit sitzendem, atmendem, blinzelndem Tier
   2. Engine und Posen
   3. Leerlauf
   4. Bridge und Hooks
   5. DOM-Signale
   6. Interaktionen
   7. Kontextmenü und Tierwechsel
   8. Einstellungen und Befehle
   9. Diagnose
   10. README
7. Alle Tests grün. `npm run build && npm run package` erzeugt die `.vsix`.
8. Installieren: `code --install-extension claude-pets-0.1.0.vsix --force`. Danach prüfen, ob die Dateien gepatcht wurden. Dafür VS Code einmal starten bzw. neu laden lassen oder die Patch-Logik über ein kleines Node-Script direkt ausführen.
9. Pushen: `git push -u origin main`. Die `.vsix` nicht committen, sondern ein Tag `v0.1.0` setzen und pushen.
10. Abschlussbericht ausgeben (Abschnitt 12).

Commit-Nachrichten auf Deutsch, im Imperativ, z. B. „Füge Animations-Engine mit Posen-Graph hinzu“.

---

## 12. Fertig, wenn …

- [ ] Das Repo ist gepusht (`main` und Tag `v0.1.0`), und alle Tests sind grün.
- [ ] Die `.vsix` ist gebaut und mit `code --install-extension` installiert. Das Icon ist `assets/icon.png`.
- [ ] Nach dem Neuladen von VS Code sitzt der Hund auf der Oberkante der Claude-Promptbox, atmet, blinzelt, wedelt und läuft gelegentlich herum.
- [ ] Tippen löst `zuschauen` aus. Prompt senden löst `aufmerksam` und dann `nachdenken` aus. Dateien lesen löst `schnueffeln` aus, Dateien schreiben `buddeln`. Ein Freigabe-Dialog löst `bellen` aus, Claude fertig `freuen`, ein Fehler `traurig`.
- [ ] Streicheln, Anstupsen, Napf, Leckerli, Spielzeug werfen, Seil, Bauch kraulen, Rufen und das Kontextmenü funktionieren.
- [ ] Der Tierwechsel funktioniert für alle 12 Tiere, sowohl im Kontextmenü als auch über die Einstellung.
- [ ] „Deaktivieren“ und die Deinstallation entfernen alle Patches und Hooks rückstandslos.
- [ ] `docs/ENTSCHEIDUNGEN.md` beschreibt:
  - gefundene Pfade;
  - CSP-Variante;
  - Selektoren;
  - Abweichungen von diesem Dokument.

Der **Abschlussbericht** ist eine kurze Liste mit diesen Punkten:

- Was funktioniert.
- Was nicht oder nur teilweise funktioniert, und warum.
- Welche Dateien außerhalb des Repos verändert wurden, mit Pfad.
- Wie man alles rückgängig macht.
