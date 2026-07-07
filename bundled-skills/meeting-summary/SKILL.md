---
name: meeting-summary
description: Compact summary of a transcript note that stays digestible in under a minute. Strictly on the transcript, no interpretations. Sets block-IDs at key passages and links each statement in the summary discreetly via ↗ symbol to the source passage. Single-note layout (summary on top, transcript below).
trigger: meeting.*summary|meeting.*zusammenfassung|protokoll|transkript.*zusammenfassung|gespraechsprotokoll|besprechung.*notiz
source: bundled
requiredTools: [read_file]
allowedTools: [read_file, edit_file, write_file, append_to_file, search_files, evaluate_expression, update_todo_list, attempt_completion]
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
   `search_files`, um Rest-Inhalte zu finden.

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

## Frontmatter-Template (Pflicht, vor dem Schreiben)

Das Frontmatter der Meeting-Note kommt aus den Settings:
`vaultIngest.templates.meetingSummaryTemplate` (vault-relativer Pfad).

Vorgehen:

1. Setting-Wert prüfen. Wenn nicht-leer:
   - `read_file path="<setting-wert>"` -> extrahiere den Frontmatter-
     Block.
   - Felder einfüllen: `Zusammenfassung`, `Datum`, `Personen`,
     `Themen`, `Konzepte`, `Projekt`, `Quellen`, `tags`.
2. Wenn Setting leer: nutze den Inline-Default unten.

**Inline-Default (Fallback wenn Setting leer):**

```yaml
---
Zusammenfassung:
Datum:
Personen:
Themen:
Konzepte:
Notizen:
Meeting-Notizen:
Projekt:
Quellen:
Kategorie:
  - Meeting-Notiz
tags:
Permanent: false
---
```

Wenn die Active-Note bereits Frontmatter hat: nicht überschreiben,
sondern fehlende Felder ergänzen. Bestehende Werte bleiben.

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

### 2. Block-IDs setzen -- in EINEM Durchgang

Pro Schlüsselpassage ein system-generated `^block-N` ans Absatz-Ende
anhängen (Leerzeichen vor dem Anker), danach Leerzeile (siehe oben).
**Eine ID pro Kernaussage**, nicht pro Satz. Idempotent: vorhandene
`^block-N`-IDs respektieren, nicht neu nummerieren.

**Effizienz-Pflicht:** NICHT pro Block-ID einen eigenen `edit_file`-Call
machen (N Runden = N mal volles Kontext-Roundtrip). Stattdessen:

- **Bevorzugt:** `evaluate_expression` -- Note einmal lesen, alle Anker
  plus Absatz-Splits im Code setzen, einmal schreiben:

  ```typescript
  const path = "<activeNote>";
  let text = await ctx.vault.read(path);
  const anchors = [
    { find: "<exakter Satz 1>", id: 1 },
    { find: "<exakter Satz 2>", id: 2 },
    // ...
  ];
  const missed = [];
  for (const a of anchors) {
    const idx = text.indexOf(a.find);
    if (idx === -1) { missed.push(a.id); continue; }
    const insertAt = idx + a.find.length;
    text = text.slice(0, insertAt) + ` ^block-${a.id}\n\n` + text.slice(insertAt).replace(/^\s+/, " ");
  }
  await ctx.vault.write(path, text);
  return { set: anchors.length - missed.length, missed };
  ```

- **Fallback** (wenn `evaluate_expression` nicht verfügbar): wenige
  `edit_file`-Calls mit mehreren Ankern pro Call bündeln.

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

Nach dem Einfügen von Ankern und Zusammenfassung:

1. `search_files` mit Pattern `\^block-\d+` auf die Note.
2. Abgleichen: Jede in der Zusammenfassung referenzierte `^block-N`
   MUSS als Anker in der Note existieren, und hinter jedem Anker muss
   eine Leerzeile oder das Dateiende stehen.
3. Fehlt ein Anker (z.B. weil ein `edit_file`/`indexOf` nicht gegriffen
   hat): Anker nachsetzen oder den Link aus der Zusammenfassung
   entfernen. **Niemals** einen Link auf eine nicht existierende
   Block-ID stehen lassen.
4. Ergebnis im Abschluss-Text nennen: "N Block-Refs gesetzt, N
   verifiziert."

## Aktionen

1. Transkript vollständig lesen (siehe Pflicht-Reihenfolge oben).
2. Erstelle die Zusammenfassung gemäß Fokus / Stil / Block-Ref-
   Konvention.
3. Setze Block-IDs an den Anker-Stellen im Transkript-Section der
   selben Note (ein Durchgang, siehe Effizienz-Pflicht).
4. Füge die Zusammenfassung als `## Zusammenfassung`-Section am
   Anfang der Datei ein (vor dem Transkript-Body).
5. Verifiziere alle Block-Refs (Schritt 5 der Konvention).

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
- `read_document` für `.md`-Dateien; pro Block-ID ein eigener
  `edit_file`-Call.
