# Jigidi Auto Solver (Tampermonkey)

Experimentelles Userscript, das ein [Jigidi](https://www.jigidi.com)-Puzzle automatisch löst: Es liest aus Jigidis eigenen Zeichenaufrufen, welches Teil wo liegt, und zieht jedes Teil per simulierter Maus an seine richtige Position.

> **Status: experimentell.** Getestet: Version 1.0 an einem 12-Teile-Puzzle, Version 1.1 an einem Puzzle mit 246 Teilen und Version 1.2 an 208 Teilen (funktioniert, war aber mit rund 1,7 s pro Teil langsam). Version 1.2 brachte wählbare Tempo-Stufen und eine Protokolldatei, Version 1.3 einen Stop-Button, Version 1.4 bildbasierte Wartezeiten (deutlich schneller bei großen Puzzles). Jigidi kann sein Verhalten jederzeit ändern, dann muss das Script angepasst werden.

## Installation

1. Einen Userscript-Manager installieren, z. B. [Tampermonkey](https://www.tampermonkey.net/) (getestet mit Firefox).
2. Das Script installieren: [`jigidi-auto-solver.user.js`](https://raw.githubusercontent.com/smo0601-collab/Jigidi-Solver-automatic-Tampermonkey/main/jigidi-auto-solver.user.js) öffnen, Tampermonkey bietet die Installation an. Fertige Versionen stehen unter [Releases](../../releases).
3. Bei Jigidi **einloggen** (nur dann speichert Jigidi den Fortschritt) und den **Zen Mode** aktivieren, siehe [Hinweise](#hinweise).
4. Andere Jigidi-Scripts (z. B. den *Jigidi Bingo Solver*) für die Seite **deaktivieren**. Beide verändern dieselben Zeichenfunktionen und stören sich gegenseitig.

## Benutzung

1. Ein Puzzle bei Jigidi öffnen.
2. Im Seitenpanel unter den Puzzle-Infos erscheint der Block **Auto Solver**.
3. Auf **Auto-Solve** klicken. Die Seite lädt neu, das Script wartet auf den Spielstart und beginnt zu ziehen.
4. Fortschritt: Statuszeile und ein Protokollfeld unter dem Button. Pro Teil steht dort Start, Ziel, tatsächliche Landeposition, Fehler in Pixeln und die Dauer in ms.
5. Am Ende (oder bei einem Fehler) wird automatisch eine **Protokolldatei** `jigidi-protokoll-<Datum>-<Zeit>.txt` heruntergeladen. Mit dem Button **Protokoll speichern** geht das auch jederzeit von Hand, auch nach einem Neuladen (das letzte Protokoll wird im Browser gemerkt).

**Stoppen:** Während des Laufs bricht der Button **Stop (Esc)** oder die Esc-Taste ab. Das Script lässt dabei die Maustaste los, speichert das Protokoll und zeigt „Gestoppt“. Ein neuer Lauf startet wieder über **Auto-Solve**.

**Tempo:** `normal`, `schnell` (Standard) oder `maximal` bestimmen, wie viele Wartepunkte (in Bildern, nicht in Millisekunden) pro Zug eingebaut sind. Bei großen Puzzles zeichnet Jigidi sehr langsam, dann kostet jeder Wartepunkt etwa ein Bild. Nach dem Loslassen wird nicht mehr fest gewartet, sondern nur, bis das Teil am Ziel angekommen ist. Wenn viele Teile als `daneben` im Protokoll stehen oder oft wiederholt werden, auf eine langsamere Stufe zurückgehen.

Das Feld „Raster px“ ist optional. `0` bedeutet automatisch. Nur wenn die Teile nicht einrasten, kann man dort die Zellgröße auf dem Bildschirm von Hand eintragen.

## So funktioniert es

- Das Script hängt sich bei `document-start` in `CanvasRenderingContext2D.putImageData` und `drawImage` ein (`@grant none`, damit der Hook auch in Firefox im Seitenkontext greift).
- Die Reihenfolge der `putImageData`-Aufrufe entspricht der Position der Teile in der Lösung (Zeile für Zeile).
- Beim Zeichnen auf den sichtbaren Canvas liest es Position und Maßstab jedes Teils aus der Transformation. Die Zuordnung Teil ↔ Nummer läuft über das Teil-Canvas, ersatzweise über die Bildgröße.
- Aus dem Zeichen-Versatz ergibt sich die Zellgröße, daraus das Zielraster. Ein Ankerteil in der Mitte wird zuerst gesetzt, danach alle anderen von innen nach außen.
- Jedes Teil wird mit mehreren `mousemove`, `mousedown`, weiteren `mousemove` und `mouseup` gezogen. Danach wird die tatsächliche Position geprüft, bei Abweichung bis zu dreimal wiederholt.

## Bekannte Grenzen

- Das Script bricht mit einer Meldung ab, wenn die Teilezahl im Panel nicht zur Zahl der von Jigidi erzeugten Teile passt.
- Es nimmt an, dass Jigidi die Teile per Canvas 2D und `putImageData` erzeugt. Bei WebGL oder Offscreen-Rendering funktioniert es nicht.
- Bei sehr vielen Teilen können Teile sich gegenseitig verdecken und das Zielraster über den sichtbaren Bereich hinausragen. Das ist nicht ausgiebig getestet.
- Ob Jigidi simulierte Eingaben dauerhaft akzeptiert, hängt vom aktuellen Jigidi-Code ab.

## Diagnose-Scripts

Unter [`tools/`](tools) liegen drei kleine Scripts, die nichts verändern und nur messen, wie Jigidi zeichnet und welche Eingaben es annimmt. Sie sind hilfreich, wenn das Script nach einer Jigidi-Änderung nicht mehr funktioniert. Immer nur eines davon aktivieren und alle anderen Jigidi-Scripts ausschalten.

| Script | Zeigt |
| --- | --- |
| `diagnose-1-aufrufe.user.js` | Anzahl der Zeichenaufrufe, Kontexttypen, Worker, WebGL |
| `diagnose-2-zeichenaufrufe.user.js` | Jeden einzelnen `putImageData`- und `drawImage`-Aufruf |
| `diagnose-3-eingabe.user.js` | Welche Eingabe-Handler Jigidi anmeldet, wie echte Eingaben ankommen |

## Hinweise

- **Fairness:** Automatisches Lösen verfälscht Bestenlisten. Aktiviere in deinen Jigidi-Einstellungen den [Zen Mode](https://www.jigidi.com/a/zen-mode/), dann erscheint keine Zeit in den Ranglisten.
- **Risiko:** Jigidi kann automatisierte Zugriffe erkennen und Konten sperren. Nutzung auf eigene Gefahr, ohne Gewähr.
- Gedacht für den eigenen Gebrauch, etwa bei Puzzles, die man sonst kaum lösen kann (z. B. einfarbige Bilder). Das Script ist nicht mit Jigidi verbunden oder von Jigidi unterstützt.

## Danksagung

Die Grundidee, Jigidis `putImageData` zu überschreiben, stammt aus den Userscripts von [Dan Q](https://danq.me) und dem [Jigidi Bingo Solver](https://github.com/f-o/Jigidi-Bingo-Solver) von f-o (MIT-Lizenz). Dieses Script ist eine eigene Neuentwicklung mit anderem Ansatz (automatisches Ziehen statt Hilfsanzeige).

## Lizenz

[MIT](LICENSE)
