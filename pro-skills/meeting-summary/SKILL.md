---
name: meeting-summary
description: Compact summary of a transcript note that stays digestible in under a minute. Strictly on the transcript, no interpretations. Sets block-IDs at key passages and links each statement in the summary discreetly via ↗ symbol to the source passage. Single-note layout (summary on top, transcript below).
trigger: meeting.*summary|meeting.*zusammenfassung|protokoll|transkript.*zusammenfassung|besprechung.*notiz
source: pro
requiredTools: [read_file]
allowedTools: [read_file, edit_file, write_file, append_to_file, update_frontmatter, find_notes_by_type, set_block_anchors, update_todo_list, attempt_completion]
---

# /meeting-summary -- Transkript-Zusammenfassung mit Block-Refs

## Ziel

Eine kompakte gut strukturierte Zusammenfassung der aktiven Note
(`{activeNote}`), die in maximal 1 Minute erfassbar ist. Halte dich
**streng** an die transkribierten Inhalte: **Keine Interpretationen,
keine Ergänzungen.**

## Transkript lesen (Pflicht-Reihenfolge)

1. `read_file path="{activeNote}"` -- niemals `read_document` für
   `.md`-Dateien.
2. Wenn das Ergebnis mit `[Truncated: ...]` endet: mit
   `read_file path="{activeNote}" offset=<angegebener Wert>` weiterlesen,
   bis das Transkript vollständig gelesen ist. **Kein** Umweg über
   `search_files`, um Rest-Inhalte zu finden. Bei einem grossen
   Kontextfenster liefert `read_file` das Transkript meist in einem
   einzigen Call.

## Fokus

Pro Thema ein Gliederungspunkt:

- Themen, Thesen, Diskussionspunkte
- Was ist passiert / wurde besprochen
- Unterschiedliche Positionen und Perspektiven inkl. Argumente
- Ergebnis oder Erkenntnis
- Warum relevant (sehr knapp, dem Diskussionspunkt zugeordnet)
- Aufgaben / Todos in `- [ ]` mit Verantwortlichen

## Stil und Struktur

- Klarer, professioneller Ton -- Ziel: schneller Wiedereinstieg, die
  wichtigsten Aussagen parat haben.
- Kein reines Bullet-Point-Format -- Erklärungen wo sinnvoll als
  kurze Sätze.
- Beginne mit Ziel, Kernaussage oder Kernergebnis (in 15 Sekunden
  erfassbar), danach wichtigste Punkte in logischer Reihenfolge, in
  thematischen Blöcken.
- Aktive Verben, kurze Hauptsätze. Keine Füllwörter, keine
  Wiederholungen.
- Inhalt in ca. 1 Minute erfassbar.
- Wichtige Aussagen **fett**.
- Überschriften `##` und `###` zur Gliederung.
- Leerzeile zwischen Überschrift und Textkörper.
- Aussagen Speakern zuordnen, wo das zweifelsfrei möglich ist.
- Am Ende Todo-Liste mit Aufgaben aus dem Termin (sofern klar besprochen).
- Neutraler, informativer Stil.

## Frontmatter (Pflicht, OKF-Schema)

Die Meeting-Note bekommt das OKF-Frontmatter (Inline-Default unten).

Quelle des Frontmatter-Blocks:

1. Wenn dir ein Template-Pfad vorliegt (aus dem Task-Kontext, den
   args oder dem Setting `vaultIngest.templates.meetingSummaryTemplate`):
   `read_file path="<template-pfad>"` und den `---`-Frontmatter-Block
   daraus extrahieren. Setting-Werte sind oft OHNE `.md`-Endung
   gespeichert: liefert `read_file` "File not found" und der Pfad hat
   keine Endung, genau EINEN Retry mit angehängtem `.md` machen.
2. In JEDEM anderen Fall den Inline-Default unten verwenden: kein
   Template-Pfad bekannt, Setting leer, Datei auch mit `.md`-Retry
   nicht lesbar, oder Template ohne Frontmatter-Block. Niemals mit
   `search_files` nach dem Template suchen, niemals wegen eines
   fehlenden Templates abbrechen -- der Inline-Default ist
   gleichwertig.

**Inline-Default (OKF-Schema):**

```yaml
---
uid:
title:
description:
resource:
tags:
type:
  - meeting
moc:
related:
timestamp:
---
```

**Felder füllen (streng aus dem Transkript, nichts erfinden):**

- `uid`: bestehenden Wert behalten. Wenn leer: selbst eine UUID im
  v4-Format erzeugen und eintragen.
- `title`: prägnanter Meeting-Titel (Thema des Termins).
- `description`: Kernergebnis des Meetings in einem Satz.
- `tags`: 3 bis 6 Schlagworte zu den besprochenen Themen
  (kleingeschrieben, kebab-case).
- `type`: muss `meeting` enthalten; bestehende Einträge ergänzen,
  nicht ersetzen.
- `timestamp`: Meeting-Datum als `YYYY-MM-DD` (aus Transkript oder
  Dateiname). Wenn nicht ermittelbar: leer lassen.
- `moc` und `related`: mit **einem einzigen** `find_notes_by_type`-Call
  befüllen (der einzige Lookup dieser Skill). Rufe
  `find_notes_by_type types=["topic", "concept", "person", "project"]`
  auf. Das Ergebnis listet die vorhandenen OKF-getypten Notes mit Titel
  und Tags. Dann:
  - `moc`: **Pflicht-Feld, nicht leer.** Ein bis vier Wikilinks auf die
    `type: topic`/`type: concept`-Notes aus dem Ergebnis, deren Titel oder
    Tags zu den Kernthemen/-konzepten des Meetings passen, im Format
    `[[<Basename>]]`. So greifen **zuerst vorhandene MOCs**. Passt zu
    einem klaren Hauptthema keine vorhandene Note, ergänze einen neuen,
    legitimen `[[<Hauptthema>]]`-Link. Bestehende `moc`-Werte behalten.
  - `related`: Wikilinks auf `type: person`/`type: project`-Notes aus dem
    Ergebnis, die im Transkript namentlich vorkommen (`[[<Basename>]]`).
    Im Zweifel weglassen. Bestehende Werte behalten.
- `resource`: leer lassen bzw. bestehende Werte behalten.

Merge-Regeln:

- **Pflicht-Tool: `update_frontmatter`.** Setze die Felder ausschliesslich
  mit `update_frontmatter path="{activeNote}" updates={...}`. **Niemals**
  `edit_file` auf den Frontmatter-Block: ein Wert mit Doppelpunkt (z.B.
  `title: Acme Kickoff: Roadmap`) bricht sonst als unquotiertes YAML.
  `update_frontmatter` quotet und serialisiert korrekt.
- Die Note hat am Ende genau EINEN `---`-Frontmatter-Block am
  Dateianfang. Existiert schon einer: in-place ergänzen, niemals
  einen zweiten Block davor setzen.
- Fehlende und leere OKF-Felder nach den Regeln oben füllen.
  "Bestehende Werte bleiben" gilt für inhaltlich gefüllte Felder;
  Platzhalter wie `title: Untitled` gelten als leer.
- Felder außerhalb des OKF-Schemas (z.B. alte `Datum`/`Personen`-
  Felder) unangetastet lassen.
- Templater-Platzhalter aus dem Template (`{{...}}`, `<% ... %>`)
  nicht übernehmen; das Feld nach den Regeln oben füllen.

## Block-Ref-Konvention

Pro Aussage in der Zusammenfassung muss ein Quell-Verweis auf die
Belegstelle im Transkript stehen.

### 1. Vorbereitung -- Struktur-Check (Pflicht)

Zwei Fälle machen Block-Refs kaputt, beide VOR dem Setzen prüfen:

- **Code-Block:** Liegt das Transkript in einem Code-Block (` ``` `),
  greifen Block-IDs nicht. Den Code-Block-Wrapper mit User-Bestätigung
  entfernen, sonst funktioniert keine Verlinkung.
- **Ein-Absatz-Transkript:** Eine Block-ID verankert immer den
  **umgebenden Absatz** (Text zwischen zwei Leerzeilen). Ist das
  Transkript ein einziger Riesen-Absatz ohne Leerzeilen, landen alle
  `^block-N` im selben Block und alle Links außer dem letzten sind
  **tot**. Deshalb: Der Anker muss am **Absatz-Ende** stehen. Nach
  jedem gesetzten `^block-N` MUSS eine Leerzeile folgen -- wenn dort
  keine ist, den Absatz an dieser Stelle splitten (Leerzeile einfügen,
  Wortlaut bleibt unverändert).

### 2. Block-IDs setzen -- in EINEM `set_block_anchors`-Call

Pro Schlüsselpassage ein system-generated `^block-N` ans Absatz-Ende.
**Eine ID pro Kernaussage**, nicht pro Satz.

Nutze dafür **`set_block_anchors`** mit ALLEN Ankern in einem einzigen
Call. Das Tool matcht robust (tolerant gegenüber Leerzeichen,
Punktuation und kleinen Transkriptions-Abweichungen), setzt jeden Anker
ans Absatz-Ende mit folgender Leerzeile, splittet Ein-Absatz-Transkripte
automatisch und ist idempotent (vorhandene `^block-N` bleiben):

```
set_block_anchors(
  path="{activeNote}",
  anchors=[
    { find: "<Zitat der Kernaussage 1>", id: 1 },
    { find: "<Zitat der Kernaussage 2>", id: 2 }
  ]
)
```

`find` muss NICHT byte-exakt sein -- ein sinngemäßes Zitat der Passage
reicht. Das Tool liefert `set` / `missed` / `ambiguous` zurück:

- Für jede ID in `missed`: das Zitat näher am Wortlaut wählen und den
  Anker erneut setzen, oder den zugehörigen Link aus der Zusammenfassung
  entfernen.
- Für jede ID in `ambiguous`: mehr umgebenden Kontext ins `find`
  aufnehmen, damit die Stelle eindeutig ist.

**Kein** eigener `edit_file`-Call pro Anker (N Runden = N Roundtrips),
**kein** manuelles Suchen der Positionen -- `set_block_anchors` erledigt
Matching, Split und Idempotenz in einem Durchgang.

### 3. Inline-Link in der Zusammenfassung

Am Ende jeder Aussage (direkt nach dem letzten Satzzeichen, ein
Leerzeichen Abstand) den Block-Ref-Link setzen:

```markdown
Skills sind Markdown-Dateien... Der Agent lädt sie erst bei
Bedarf. [[#^block-7|↗]]
```

Pflicht-Form:

- **Same-Note-Ref** (Summary und Transkript in derselben Datei):
  `[[#^block-N|↗]]`
- **Cross-Note-Ref** (Summary in eigener Note): `[[Transkript#^block-N|↗]]`
- Display-Text immer **nur** `↗`, kein "Quelle", kein "[1]".
- Inline am Satzende, **nicht** auf eigener Zeile.

### 4. IDs sind stabil

Einmal gesetzte Block-IDs nicht umbenennen, sonst brechen die
Wikilinks.

### 5. Verifikation (Pflicht, vor attempt_completion)

Die Verifikation läuft **allein über das `set_block_anchors`-Ergebnis** --
kein zusätzlicher `search_files`-Lauf nötig (das Tool hat die Note bereits
geprüft):

1. Nur IDs aus `set` sind verlinkbar. Für jede ID in `missed`/`ambiguous`
   den Anker mit einem besseren `find` erneut setzen (ein weiterer
   `set_block_anchors`-Call) oder den Link aus der Zusammenfassung
   entfernen.
2. **Niemals** einen Link auf eine nicht in `set` bestätigte Block-ID
   stehen lassen.
3. Ergebnis im Abschluss-Text nennen: "N Block-Refs gesetzt, N
   verifiziert." Zahlen direkt aus dem `set`-Array.

## Aktionen

1. Transkript vollständig lesen (siehe Pflicht-Reihenfolge oben). Dabei
   prüfen, ob die Note **bereits** eine `## Zusammenfassung`-Section und
   `^block-N`-Anker enthält (schon einmal verarbeitet). Wenn ja: **nicht**
   alles neu erzeugen -- nur fehlende Felder/Anker ergänzen und mit einem
   kurzen Hinweis abschliessen, dass die Note bereits zusammengefasst ist.
2. Erstelle die Zusammenfassung gemäß Fokus / Stil / Block-Ref-
   Konvention.
3. Setze Block-IDs an den Anker-Stellen im Transkript-Section der
   selben Note mit einem einzigen `set_block_anchors`-Call.
4. Setze das OKF-Frontmatter am Dateianfang mit `update_frontmatter`
   (siehe Frontmatter-Abschnitt): fehlende Felder ergänzen, bestehende
   Werte behalten. **Kein `edit_file` auf den Frontmatter-Block.**
5. Füge die Zusammenfassung als `## Zusammenfassung`-Section nach
   dem Frontmatter ein (vor dem Transkript-Body).
6. Werte das `set_block_anchors`-Ergebnis aus (Verifikation, siehe oben).

## Pflicht

Führe alle Schritte ohne weitere Rückfrage aus und stoppe erst,
wenn du fertig bist. Behalte bestehende Inhalte unverändert bei.

Das Setzen der Block-IDs zählt **nicht** als Inhaltsänderung -- die
IDs sind unsichtbar im Reading-Mode und dienen nur als Wikilink-Anker.
Das gilt auch für die Leerzeilen der Absatz-Splits: der Wortlaut
bleibt identisch, nur die Absatz-Struktur wird für die Anker
aufbereitet.

## Verboten

- Bestehende Inhalte löschen.
- Transkript in der Zusammenfassung wiederholen.
- `[1]`-, `[2]`-Marker im Perplexity-Stil verwenden.
- Sprechende `^kebab-id` Block-IDs erfinden (System-generated `^block-N`).
- Zusammenfassung ohne Block-Ref-Marker ausgeben.
- Links auf Block-IDs, die nicht verifiziert in der Note stehen.
- Interpretationen oder Ergänzungen über den Transkript-Inhalt
  hinaus.
- `read_document` für Vault-Notes, auch für den Template-Pfad
  (immer `read_file`).
- Pro Block-ID ein eigener `edit_file`-Call. Block-Anker werden
  ausschliesslich per `set_block_anchors` in einem Durchgang gesetzt.
- `edit_file` auf den Frontmatter-Block (bricht YAML). Frontmatter
  ausschliesslich per `update_frontmatter`.
- `search_files` in dieser Skill. Die Block-Ref-Verifikation läuft über
  das `set_block_anchors`-Ergebnis.
- Mehr als **ein** `find_notes_by_type`-Call. Er dient ausschliesslich
  dem einmaligen moc/related-Lookup, für nichts anderes.
