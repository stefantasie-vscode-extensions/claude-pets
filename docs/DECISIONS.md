# Entscheidungen

Dieses Dokument hält fest, was beim Bau von Claude Pets 0.1.0 vorgefunden wurde, wie die
offenen Punkte aus `docs/PROMPT.md` gelöst sind und wo bewusst davon abgewichen wurde.
Untersucht wurde Claude Code **2.1.322** (`anthropic.claude-code-2.1.322-darwin-x64`).

## 1. Gefundene Pfade

| Was | Pfad (relativ zum Extension-Ordner) | Ermittlung |
| --- | --- | --- |
| Webview-Script | `webview/index.js` (≈ 6 MB, ES-Modul, `type="module"`) | Standardpfad vorhanden |
| Webview-Stylesheet | `webview/index.css` | Standardpfad vorhanden |
| HTML-Erzeugung + CSP | `extension.js` (`package.json` → `main`), Methode `getHtmlForWebview()` | Suche nach `Content-Security-Policy` |

`extension.js` baut die Pfade selbst mit
`He.Uri.joinPath(this.extensionUri,"webview","index.js")` bzw. `…"index.css"`. Der Locator
(`src/claudeLocator.ts`) prüft deshalb in dieser Reihenfolge: Standardpfade → die per
`joinPath(…"webview","*.js|css")` im HTML-Erzeuger genannten Dateien → größte `.js`/`.css`
im `webview`-Ordner. Die Diagnose zeigt, welcher Weg gegriffen hat.

Die Extension wird über `vscode.extensions.all` gesucht (ID ohne Beachtung der
Groß-/Kleinschreibung). Das Deinstallations-Script kennt die VS-Code-API nicht und durchsucht
`~/.vscode/extensions`, `~/.vscode-insiders/extensions`, `~/.vscode-oss/extensions`,
`~/.vscode-server*/extensions` sowie `$VSCODE_EXTENSIONS` nach `anthropic.claude-code-*`.

## 2. Content-Security-Policy: Variante A

Claude Code setzt für seinen Webview:

```text
default-src 'none'; style-src <cspSource> 'unsafe-inline'; font-src <cspSource>;
img-src <cspSource> data:; script-src 'nonce-…'; worker-src <cspSource>;
```

Es gibt kein `connect-src`, also greift `default-src 'none'` – `fetch`/`EventSource` zu
`http://127.0.0.1` wären blockiert. Gewählt ist **Variante A**: In `extension.js` wird in die
Template-Zeichenkette ein einziger Ausdruck eingefügt:

```js
… script-src 'nonce-${d}'; ${v}; ${' connect-src http://127.0.0.1:* http://localhost:*;'/*claude-pets:csp*/}">
```

Begründung:

- Der JS-Kommentar im Template-Ausdruck ist die Markierung; das gerenderte HTML enthält ihn
  nicht. Entfernen heißt, genau diesen Ausdruck herauszuschneiden – das Original ist danach
  byteweise wiederhergestellt (getestet).
- Vor dem Schreiben wird die geänderte `extension.js` mit `vm.Script` kompiliert; ist sie
  syntaktisch kaputt, wird nichts geschrieben. Sicherung `extension.js.claude-pets.bak`,
  atomares Schreiben, idempotent.
- Nur CSPs mit `script-src 'nonce-${…}'` werden angefasst (der Webview von Claude); die
  zweite, statische CSP der Plan-Vorschau bleibt unberührt.
- Gibt es bereits ein `connect-src`, werden die Quellen dort ergänzt statt eine zweite
  Direktive anzuhängen (die zweite würde ignoriert).

Damit wird – abweichend von „nur diese zwei Dateien anfassen“ – eine dritte Datei verändert.
Das ist die in Abschnitt 4.3 vorgesehene Variante A. Mit `claudePets.patchCsp = false` wird
der Eingriff zurückgenommen; dann läuft **Variante B** (reiner DOM-Modus, Hooks erreichen das
Tier nicht). Die Diagnose zeigt die aktive Variante.

Da `extension.js` beim Start von VS Code geladen wird, wirkt die CSP-Änderung erst nach
„Fenster neu laden“ – dieselbe Aktion, die auch das Webview-Script braucht.

## 3. Selektoren (`src/webview/selectors.ts`)

Claude Code verwendet CSS-Module (`inputContainer_cKsPxg`); der Hash-Anteil ändert sich
zwischen Builds, deshalb wird nur der Präfix gematcht (`[class*="inputContainer_"]`). Wo
möglich, gehen ARIA-Attribute vor.

| Zweck | Selektoren (Reihenfolge = Priorität) |
| --- | --- |
| Eingabefeld | `[role="textbox"][aria-label="Message input"]` · `[class*="messageInput_"][contenteditable]` · `[contenteditable][data-placeholder]` · `fieldset [contenteditable="plaintext-only"]` · `form textarea` |
| umrandete Box | `fieldset[class*="inputContainer_"]` · `[class*="inputContainer_"]` · `fieldset` · `form` · sonst nächster Vorfahr mit sichtbarer oberer Umrandung |
| Freigabe-Karte | `[class*="permissionRequestContainer_"]` · `[class*="permissionsContainer_"] > *` |
| Claude arbeitet | `button[type="submit"][aria-label="Stop"]` · `[class*="sendButton_"] [class*="stopIcon_"]` · `[class*="stopIcon_"]` |
| Senden-Knopf | `button[type="submit"][class*="sendButton_"]` · `form button[type="submit"]` |
| schwebende UI | `[role="menu"]`, `[role="listbox"]`, `[role="dialog"]`, `[role="tooltip"]`, `[role="alertdialog"]` |
| Sitzungs-ID | `#root[data-initial-session]` |

Wichtige Befunde zur Struktur:

- Warnungen wie „You've used 94 % of your weekly limit“ sind **Geschwister** über dem
  Formular (`div.banner_*`, `border-radius: 8px 8px 0 0`, `margin-bottom: -8px`) und docken
  optisch an die Box an. `mount.ts` sammelt solche angedockten Elemente (sichtbar, im
  normalen Fluss, berühren/überlappen die Oberkante, ≥ 60 % der Boxbreite) und setzt das Tier
  auf die Oberkante des ganzen Stapels.
- Während einer Freigabe-Anfrage bekommt der Eingabebereich `display: none`, und die
  Freigabekarte erscheint an seiner Stelle. Das Tier zieht dann auf die Karte um.
- Fehlt ein Selektor, fällt das jeweilige Merkmal still weg.

## 4. Abweichungen und Präzisierungen

### Icon

- Auf ausdrücklichen Wunsch von Stefan zeigt `assets/icon.png` in der Box die obere Hälfte
  des orangefarbenen Claude-Sterns (aus `resources/claude-logo.svg` der Claude-Code-
  Extension, im 1-px-Raster der Boxecken gerastert). Das Original aus dem Paket liegt im
  ersten Commit. Hinweis: Der Stern ist ein Markenzeichen von Anthropic; für eine
  Veröffentlichung im Marketplace sollte das geprüft werden.

### Positionierung

- Das Overlay `#claude-pets-root` hängt mit `position: fixed` an `document.body`, nicht im
  React-Baum von Claude. React kann es so nie entfernen; die Position wird **in jedem Frame**
  aus dem gemessenen Rechteck der Box (plus angedockte Banner) übernommen. Damit folgen
  Tier, Napf und Spielzeug jeder Höhen- und Breitenänderung (mehrzeiliger Text, Banner,
  schmaleres Panel). `MutationObserver` und `ResizeObserver` stoßen zusätzlich eine neue
  Suche an.
- Klickfläche ist nicht das ganze 24×24-Feld, sondern die deckenden Pixel der aktuellen
  Animation, höchstens bis Reihe 22 – so wird über der Box möglichst wenig verdeckt und nie
  etwas in der Box.
- Liegt schwebende UI (Slash-Menü, Popups, Tooltips, Dialoge) über dem Tier, wird es
  ausgeblendet und klickdurchlässig, bis die UI wieder verschwindet. Eigene Elemente
  (Kontextmenü, Seil) zählen nicht.

### Bridge und Datenschutz

- **Sitzungsbindung:** Der Webview kann nicht erkennen, zu welchem VS-Code-Fenster er gehört,
  und verbindet sich daher mit allen erreichbaren Bridges (Ports aufsteigend ab 47811,
  Abbruch nach zwei Fehlversuchen). Damit ein Tier nur auf seine eigene Claude-Sitzung
  reagiert, bekommt jedes Ereignis zusätzlich `sid`, einen 8-stelligen FNV-1a-Hash der
  `session_id` (nicht umkehrbar, keine Inhalte). Gebunden wird über `data-initial-session`
  (fortgesetzte Sitzung) oder über das erste `UserPromptSubmit` innerhalb von 4 s nach einem
  im eigenen Webview abgeschickten Prompt. Ungebundene Tiere reagieren auf alle Sitzungen.
- `dist/hook.js` schickt bereits ein **verschlanktes** Payload (Event-Name, Session-ID, `cwd`,
  Tool-Name, Bash-Befehl für die Tag-Erkennung, Statusfelder aus `tool_response` ohne
  Inhalte). Prompts, Dateiinhalte und Tool-Ausgaben verlassen den Hook-Prozess nicht. Der
  Host filtert danach wie gefordert auf Event, Tool, Bash-Tag, Erfolg, Notification-Typ.
- **Token:** Maßgeblich ist `~/.claude-pets/token` (Rechte 0600); `globalState` spiegelt es
  nur. Grund: Bei der Erstinstallation aktivierten sich zwei offene Fenster gleichzeitig,
  `globalState` ist zwischen Fenstern nicht atomar, und beide erzeugten verschiedene Tokens –
  eines davon passte nicht zum eingebetteten. Die Datei wird per `link()` angelegt (atomar,
  scheitert, wenn sie existiert), sodass genau ein Token gewinnt.
- Die Bridge prüft zusätzlich den `Host`-Header (Schutz vor DNS-Rebinding) und beantwortet
  CORS-Preflights inklusive `Access-Control-Allow-Private-Network`.
- Erfolg von `PostToolUse`: Laut Doku landet ein Bash-Befehl mit Exit-Code ≠ 0 als
  `PostToolUseFailure` („Exit code N“). `freuen` gibt es daher nur, wenn `PostToolUse` für
  Bash die bekannte Form `{stdout, stderr, interrupted: false}` hat (oder ein Exit-Code 0
  explizit vorliegt). Hintergrundbefehle, Zeichenketten und Unbekanntes ergeben „unbekannt“
  (keine Reaktion außer dem Folgezustand).

### Verhalten

- **Prioritäten:** Ein `while`-Zustand eines Hooks endet mit dem nächsten Hook-Ereignis
  (außer eine `until`-Liste verbietet es), DOM-Signale folgen strikt den Prioritäten.
  Einmal-Animationen laufen zu Ende; währenddessen eintreffende Hooks werden gemerkt (das
  neueste gewinnt) und folgen direkt danach. Folgezustände (`then`) haben die Priorität
  `min(eigene, thinking)`, damit z. B. Escape (`error`) sie unterbrechen kann.
- **Prompt senden:** Enter im Eingabefeld (nur, wenn es nicht leer ist – geprüft über das
  Vorhandensein von Kindknoten, nie über den Text), Klick auf „Senden“ oder – als Rückfall –
  das Erscheinen des Stopp-Knopfs spielen sofort `aufmerksam` → `nachdenken`. Das kurz danach
  eintreffende `UserPromptSubmit` dient nur noch der Sitzungsbindung (keine Doppelung).
- **Übergänge:** Explizit genannte Übergangsanimationen (`umdrehen`, `hinlegen`,
  `auf_den_ruecken_rollen`, auch `:reverse`) werden übersprungen, wenn das Tier nicht in ihrer
  Start-Pose ist; den Rest erledigt der Posen-Graph. Die Kanten des Graphen stammen aus dem
  Atlas der jeweiligen Tierart (die Krabbe rollt z. B. direkt von `sit` nach `belly`).
- **Aufwachen:** `aufwachen` wird nur gespielt, wenn das Tier wirklich schläft (bei
  `SessionStart` und beim Wecken aus dem bloßen Liegen entfällt es).
- **Liegen/Schlafen:** Hinlegen nach `min(90 s, 37,5 % der Einschlafzeit)`, Einschlafen nach
  `claudePets.idle.sleepAfterMinutes` – beides gemessen ab der letzten echten Aktivität.
- **Maus am liegenden Tier:** Darüberfahren weckt ein liegendes Tier nicht, und
  Hin-und-her-Streicheln wird dort nicht ausgewertet – sonst wäre Kreisen → Bauchkraulen
  nie erreichbar (ein Kreis enthält selbst Richtungswechsel). Klicken, Knöpfe und Menü
  wecken es.
- `knochen_bringen` läuft bei `SubagentStop` 1,5 s (Hinweis in `triggers.json`),
  `WorktreeCreate` nutzt `duration_ms`. Andere Schleifenanimationen in `play`-Listen spielen
  genau einen Durchlauf.
- Laufgeschwindigkeiten exakt nach Vorgabe (`gehen` 1 px/Frame bei 10 fps ≈ 20 CSS-px/s bei
  Skalierung 2). Rufen über die ganze Box kann deshalb 10–25 s dauern.
- Hoppelnde Tiere bewegen sich nur in Frames, deren unterste deckende Pixelreihe über der
  Fußlinie (Reihe 22) liegt – das wird beim Laden aus dem Atlas ermittelt. Hat eine
  Animation keinen solchen Frame, bewegt sie sich gleichmäßig.

### Einstellungen und Befehle

- Alle Einstellungen haben `"scope": "application"`: Die Injektion ist global; abweichende
  Arbeitsbereichswerte würden sich zwischen Fenstern gegenseitig „umpatchen“.
- „Deaktivieren“ entfernt Injektion, CSP-Ergänzung **und** Hooks (Abschnitt 12 verlangt
  rückstandsloses Entfernen); „Aktivieren“ richtet alles wieder ein.
- „Hooks entfernen“ setzt `claudePets.hooks.enabled = false`, „Hooks installieren“ setzt es
  auf `true` – sonst kämen entfernte Hooks beim nächsten Start automatisch zurück.
- Einstellungsänderungen werden sofort neu gepatcht **und** live über die Bridge an
  verbundene Webviews geschickt (Tier, Skalierung, Knöpfe, Bewegung …). Ein Neuladen wird nur
  angeboten, wenn kein Webview verbunden ist oder die Injektion neu ist.
- Bei `zufall` zeigt die Statusleiste das tatsächlich gewählte Tier (der Webview meldet es
  per `POST /species` mit `persist: false`).

### Deinstallation

- `vscode:uninstall` entfernt Blöcke und CSP-Ergänzung in allen gefundenen Claude-Code-
  Versionen, die Hooks und `~/.claude-pets`. Sicherungen in Claudes Ordnern werden gelöscht,
  wenn sie byteweise der wiederhergestellten Datei entsprechen.
  `~/.claude/settings.json.claude-pets.bak` bleibt absichtlich als Sicherheitsnetz liegen.
- VS Code führt `vscode:uninstall` erst beim nächsten Start nach der Deinstallation aus.

### Roboter (Paket 2, Version 0.1.1)

- `assets/09_roboter/atlas.png` stammt aus `claude-pets-paket-2.zip`; alle 363 Frames sind
  neu gezeichnet (schwebender Roboter mit Düsenflamme), `atlas.json` und `objects.png` sind
  byteidentisch geblieben. Das Icon aus Paket 2 ist das ursprüngliche und wurde nicht
  übernommen (siehe „Icon“).
- In 98 Frames reicht die Flamme bis in Reihe 23, also eine Reihe unter die Fußlinie: Sie
  setzt sichtbar auf dem Rand der Box auf. Das ist Teil der Grafik und bleibt so. Die
  Klickfläche endet weiterhin bei Reihe 22, Klicks in die Box sind nicht betroffen.
- Da `v0.1.0` bereits veröffentlicht war, erscheint die Änderung als Version 0.1.1 statt
  eines nachträglich verschobenen Tags.

### Neuladen nach Updates

- Einstellungen werden live über die Bridge übertragen; Code, Grafiken und Stylesheet stecken
  dagegen im eingeschleusten Block und wirken erst nach dem Neuladen des Webviews.
  `blockPayload()` vergleicht deshalb den Block ohne die eingebettete Konfiguration: Ändert
  sich dieser Teil (oder das CSS), wird immer ein Neuladen angeboten.

### Werkzeuge

- TypeScript 5.9 statt 7.x (der native Compiler ist noch neu; 5.9 ist für `--noEmit` mit
  esbuild bewährt). `@types/vscode` ist auf 1.90.0 festgelegt, passend zu `engines.vscode`.
- Debug-Modus (`claudePets.debug`): Ereignisse im Ausgabekanal und in
  `~/.claude-pets/debug.log`; im Webview steht `window.__claudePets` für die Webview-DevTools
  bereit.
