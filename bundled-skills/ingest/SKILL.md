---
name: ingest
description: Quick single-pass ingest of a source (PDF/Markdown/URL/DOCX/PPTX/XLSX) into one note (OKF frontmatter + overview + key points + original text). PDFs stay page-refs (no mirror enforcement). Block-refs to the source rendered as a discreet ↗ symbol per key point. No multi-turn dialog.
trigger: schneller.*ingest|quick.*ingest|inbox.*aufnahme|webclip.*ingest|aufnehmen.*note|integriere.note
source: bundled
requiredTools: [ingest_document, write_file, read_file, update_frontmatter]
---

# /ingest -- Schneller Single-Pass-Ingest

## Wann nutzen

Schnelle Inbox-Aufnahme, image-heavy PDFs, kurze Webclips,
Office-Files. Erwartung: 30 Sekunden bis 2 Minuten, eine Datei als
Output.

Nicht fuer tiefe Sense-Making-Notes (-> /ingest-deep), nicht fuer
Meeting-Transkripte (-> /meeting-summary).

## Kosten-Disziplin

- **Ein Tool-Call.** `ingest_document`. Keine read_document-Pre-Reads,
  keine list_files-Erkundung.
- **STOP-on-Error.** Bei Tool-Fehler: User informieren, fertig.

## Sprache und Stil

Pflicht fuer alle Chat-Texte und alle erzeugten Notes:

- **Sprache:** Source ist deutsch -> Output deutsch. Source ist englisch
  -> Output englisch. Niemals Sprachen mischen (kein einleitendes
  "I'll start by..." wenn der Rest auf Deutsch ist).
- **Umlaute korrekt schreiben:** ä, ö, ü, ß als echte Zeichen. NIE
  ae/oe/ue/ss als Ersatz. Beispiele: "Veränderung" (nicht
  "Veraenderung"), "größte" (nicht "groesste"), "über" (nicht
  "ueber"), "müssen" (nicht "muessen"). Gilt fuer:
  - **Frontmatter** (`title`, `description`, deutsche `tags`,
    `moc`-Werte mit deutschen Begriffen).
  - **Body** (Overview, Kernaussagen) bei deutscher Source.
  - **Markdown-Reproduktion der Quelle** (Source-Mirror): wenn der
    Source-Text deutsch ist, muessen ä/ö/ü/ß im erzeugten Markdown
    erhalten bleiben. Falls der PDF-Parser fehlerhafte Substitutionen
    liefert (haeufig "ae" statt "ä", "ss" statt "ß"), die Umlaute
    in Frontmatter, Overview und Kernaussagen vor dem Speichern
    korrigieren.
  - **Ausnahmen:** Eigennamen, Identifier, Pfade und englische
    Begriffe bleiben unveraendert (z.B. "Anthropic", "Foundation",
    "src/path/foo.ts").
- **Keine em-dashes (—) und keine en-dashes (–)** in Chat-Antworten
  oder erzeugten Notes. Stattdessen Punkt, Komma, Klammer oder Worte
  wie "und", "aber", "also".
- **Keine AI-Floskeln:** kein "landscape", "leverage", "robust",
  "seamless", "delve", "crucial", "nuanced", "holistic", "foster",
  "ensuring", "highlighting", "underscoring". Aktive Stimme,
  konkrete Worte.
- **Bei Sense-Making-Notes (Step 4): /humanizer-Regeln Pflicht.**
  Diese Notes sind Eigentext des Skills, kein Source-Zitat -- sie
  muessen wie von einem Menschen geschrieben klingen.
  - Keine aufgeblaehte Symbolik, keine Fueller, keine Meta-Signposting
    ("Hier sehen wir, dass...", "Es ist wichtig zu erwaehnen, dass...",
    "Im Folgenden wird gezeigt...").
  - Keine negativen Parallelismen ("nicht X, sondern Y").
  - Keine "Rule of three" (drei rhetorische Aufzaehlungen am Stueck).
  - Vage Attributionen vermeiden ("Studien zeigen", "Experten sagen").
  - Sentence Case in Ueberschriften, aktive Stimme, konkrete
    Substantive statt Nominalisierungen.

## Frontmatter-Master: OKF Template (Pflicht)

Alle Notes -- Source-Mirror, Sense-Making, Zettel -- nutzen
ausschliesslich das **OKF Template** als Frontmatter-Vorlage:

`Tools & Settings/Templates/OKF Template.md`

Andere Templates (`Quelle Template.md`, `Zettel Template.md`,
`Notiz Template.md`) sind abgeloest und werden nicht mehr gelesen.

## Step 0a: OKF Template lesen (Pflicht, vor dem ingest_document-Aufruf)

Vorgehen:

1. `read_file path="Tools & Settings/Templates/OKF Template.md"`.
2. Extrahiere den Frontmatter-Block zwischen den `---`-Zeilen
   **verbatim** als String. Achtung: das OKF Template schliesst mit
   `---\n---\n` (zwei Trenner direkt hintereinander). Nimm nur den
   ERSTEN Frontmatter-Block, ignoriere das zweite `---`.
3. Wenn der Read fehlschlaegt, nicht retryen -- nutze den
   Inline-Default unten.

**OKF-Properties (in dieser Reihenfolge):**

```yaml
---
title:
description:
resource:
tags:
type:
moc:
related:
timestamp:
uid:
---
```

**Pflicht-Werte je Note-Typ:**

| Property | Source-Mirror | Sense-Making / Zettel |
|---|---|---|
| `title` | Dateiname ohne `.md`-Suffix | sprechender Konzept-Titel |
| `description` | 1 Satz Deutsch, max 25 Woerter -- die Quintessenz | 1 Satz Deutsch, max 25 Woerter |
| `resource` | URL der Quelle (Webclip) ODER **Markdown-Link** mit Dateiname als Label und explizitem Vault-Pfad zum Original-Binary (`"[Autor-Jahr_Titel.pdf](attachments/Autor-Jahr_Titel.pdf)"`) -- KEIN Wikilink fuer PDF/DOCX/PPTX/XLSX | Wikilink basename-only zur Source-Mirror-Note (`"[[Autor-Jahr_Titel]]"`) |
| `tags` | 3-5 Keywords lowercase, bindestrich-verbunden | 3-5 Keywords lowercase, bindestrich-verbunden |
| `type` | YAML-Liste, erster Wert `- source`. Zweiter Wert (optional) der spezifische Quell-Typ: `- Analyst Report` / `- Interview` / `- Blog Post` / `- Buch` / `- Podcast` etc. | YAML-Liste mit `- note` (Sense-Making) oder `- zettel` (Multi-Zettel). Zweiter Wert optional. |
| `moc` | 2-5 Wikilinks auf Themen/Konzept-Notes (Taxonomie) | 2-5 Wikilinks |
| `related` | Wikilinks auf Autor(en) als Person-Notes, andere relevante Personen, Projekte, Meeting-Notes, abgeleitete Notes (abgeleitete Notes werden in Step 5 ergaenzt) | Wikilinks zu thematisch verwandten Notes, Personen, Projekten |
| `timestamp` | Veroeffentlichungsdatum der Quelle (ISO 8601 `YYYY-MM-DDTHH:MM:SS`) -- ehemals "Jahr" | Erstellungsdatum der Note |
| `uid` | leer (UID-Plugin fuellt) | leer |

## Frontmatter-Hygiene (Pflicht fuer JEDE Note)

1. **ALLE String-Werte IMMER doppel-gequotet.** Keine Ausnahmen.
   Strings sind alle Werte hinter einem Doppelpunkt, die KEINE der
   folgenden Sonderformen sind:
   - YAML-Liste (`- ...` darunter eingerueckt)
   - Boolean (`true`, `false`), Zahl (`42`), leerer Wert
   - ISO-Datetime ohne Sonderzeichen ist Spezialfall (gequotet ist
     sicher: `timestamp: "2026-06-29T12:00:00"`)

   Innerhalb von gequoteten Strings escape `"` mit `\"`.

2. **`tags`-Format (verbindlich):**
   - YAML-Liste, ein Eintrag pro Zeile mit `- ` Prefix.
   - 3-5 Eintraege.
   - Alle kleingeschrieben, auch Akronyme und Eigennamen
     (`ai-agent`, `rag`, `obsidian-workflow`).
   - Mehr-Wort-Begriffe per Bindestrich verbunden, max 2 verbundene
     Woerter pro Keyword.
   - Deutsch und Englisch mischen, englische Variante bevorzugen wenn
     gebraeuchlicher.

3. **`moc`-Format:** YAML-Liste mit gequoteten Wikilinks, 2-5 Eintraege.
   ```yaml
   moc:
     - "[[Agentic AI]]"
     - "[[Verifiability]]"
   ```
   **STRIKT: `moc` nimmt AUSSCHLIESSLICH Wikilinks auf Notes mit
   `type: - topic` oder `type: - concept` auf.** Alles andere
   (Projekte, Personen, andere Quellen, Sense-Making-/Zettel-Notes,
   Tools, Meetings, MOCs) gehoert nach `related:`. Beim Setzen des
   Frontmatters fuer jeden Kandidaten kurz via `get_frontmatter` das
   `type:`-Feld der Ziel-Note pruefen und entsprechend einsortieren.

   Suche IMMER zuerst im Vault nach passenden vorhandenen
   `moc`-Eintraegen / Themen / Konzept-Notes via `search_vault`.
   Erstelle nur dann einen neuen Wikilink, wenn keine passende Note
   existiert -- und auch dann nur, wenn der Konzept-Titel klar ein
   Thema oder Konzept ist. Unresolved Wikilinks sind OK, Obsidian
   zeigt sie als gepunktete Knoten im Graph.

4. **`related`-Format:** YAML-Liste mit gequoteten Wikilinks zu
   konkreten Notes mit relevanter Verbindung. Hier kommen rein:
   - **Personen** (Autor der Quelle PLUS weitere relevante Personen)
     als Wikilink auf eine Person-Note (`type: - person`). Wenn die
     Person-Note noch nicht existiert: Wikilink trotzdem schreiben
     (Unresolved Link), Obsidian zeigt den gepunkteten Knoten und der
     User kann die Person-Note spaeter befuellen.
   - **Projekte** (`type: - project`) als Wikilink.
   - **Meeting-Notes** (`type: - meeting`) als Wikilink.
   - **Andere thematisch verbundene Notes** (Sense-Making, Zettel,
     andere Sources).
   - Bei Source-Mirror: **alle abgeleiteten Notes**, die in Step 5
     ergaenzt werden.

   Beispiel:
   ```yaml
   related:
     - "[[Miles Gibson]]"
     - "[[LLMs als Ghosts]]"
     - "[[Projekt IT-Operating-Model 2026]]"
   ```

   **Abgrenzung `moc` vs. `related`:** `moc` ist die Taxonomie
   (Themen/Konzept-Hubs, Map of Content -- breite thematische
   Einordnung). `related` ist die konkrete Verbindung zu einzelnen
   anderen Notes (Personen, Projekte, andere Quellen).

5. **`type`-Format:** YAML-Liste mit Bindestrich, 1-2 Werte.
   - Erster Eintrag (Pflicht) ist die **Note-Kategorie**:
     `- source` | `- note` | `- zettel` | `- moc` | `- person` |
     `- project` | `- meeting`.
   - Zweiter Eintrag (optional) ist der **inhaltliche Typ** der
     Quelle, z.B. `- Analyst Report`, `- Interview`, `- Blog Post`,
     `- Buch`, `- Podcast`, `- Whitepaper`, `- Studie`, `- Talk`.
   - Beispiel:
     ```yaml
     type:
       - source
       - Analyst Report
     ```
   - Nie als Inline-Array `[source, Analyst Report]`.

6. **`description`:** ein einziger Satz auf Deutsch, max 25 Woerter.
   Keine Erklaerungen, keine zusaetzlichen Texte. Wenn die
   Zusammenfassung laenger waere, radikal kuerzen.

7. **`timestamp`:** ISO-Datetime, gequotet (`"2026-06-29T12:00:00"`).
   **Vollstaendiges Datum (YYYY-MM-DD)**, nicht nur Jahr. Wenn nur das
   Jahr bekannt ist, im Source-Text nach Tag und Monat suchen
   (Abgabedatum, Erscheinungsdatum, Publication date, Copyright-Jahr
   mit Monat, Issue-Datum, Header/Footer der ersten Seiten). Erst wenn
   nirgends ein praeziseres Datum steht, auf
   `YYYY-01-01T00:00:00` defaulten.
   - Source (`type: source`): Veroeffentlichungsdatum der Quelle.
     Beispiele: PDF mit "Abgabedatum: 03.09.2025" ->
     `"2025-09-03T00:00:00"`. Blog "Published Jan 15, 2026" ->
     `"2026-01-15T00:00:00"`.
   - Meeting: Datum des Meetings.
   - Sonst: Erstellungsdatum der Note (Fallback).

8. **`uid:` leer lassen.** Wenn ein UID-Plugin (z.B.
   `note_uid_generator`) mit Auto-Generation aktiv ist, fuellt das
   Plugin den Wert beim Note-Create selbst. Skill macht keine
   eigenen UID-Tool-Calls.

9. **Leere Felder nicht entfernen.** Das Template enthaelt leere
   Slots fuer Felder, die der User spaeter manuell fuellt. Stehen
   lassen.

## Step 0: Source-Typ und Tool-Wahl

Schau in deinen Kontext:

| Quelle | Aufruf |
|---|---|
| `<attached_document name="..." pages="N">` ohne `vault_path` (frisch in Chat geladen) | `ingest_document` mit `attachment_index: 0` -- **TURN 1 noch waehrend das Attachment lebt**. Auf spaeteren Turns ist das Attachment weg. |
| `<attached_document vault_path="...">` oder User nennt Vault-Pfad | `ingest_document` mit `source_path: "<pfad>"` |
| Reine URL ohne Attachment | requestUrl + write_file (Tool-Pfad ohne ingest_document) |
| Markdown im Vault | `ingest_document` mit `source_path` ist optional; bei reinen MD-Sources reicht `update_frontmatter` + Block-IDs |

**Ablage-Regel:** ALLE Markdown-Outputs landen in `<defaultOutputFolder>/`
(Default `Inbox/`, aus den Plugin-Settings). Originale Binaries
(PDF/DOCX/PPTX/XLSX) gehen nach `Attachements/<Autor>-<Jahr>_<Titel>.<ext>`.
Keine neuen Ordner anlegen, kein `Sources/`, kein `Notes/`. Wenn der
defaultOutputFolder fehlt, legt das Plugin ihn beim ersten Schreibvorgang
an. Naming-Convention: `<Autor>-<Jahr>_<Titel>` (englisch transliteriert,
Bindestrich zwischen Autor und Jahr, Unterstrich zwischen Jahr und
Titel, Bindestriche im Titel). Ohne bekannten Autor/Jahr: `<Titel>`.

## Step 1: ingest_document aufrufen

Aufrufkonvention:

```
ingest_document
  source_path | attachment_index = "<source>"
  output_path = "<defaultOutputFolder>/<Autor>-<Jahr>_<Titel>.md"
  header_content = """
    ---
    title: "<Autor>-<Jahr>_<Titel>"
    description: "<1 Satz Deutsch, max 25 Woerter>"
    resource: "<URL ODER [<dateiname.ext>](<vault-path-zum-binary>) als Markdown-Link mit Dateiname als Label>"
    tags:
      - <keyword-1>
      - <keyword-2>
      - <keyword-3>
    type:
      - source
      - <inhaltlicher Typ, z.B. Analyst Report>
    moc:
      - "[[Thema 1]]"
      - "[[Konzept 2]]"
    related:
      - "[[<Autor-Vorname Nachname>]]"
    timestamp: "<ISO-Datetime der Quelle>"
    uid:
    ---

    # <Titel>

    ## Overview

    <2-3 Saetze, Kernbotschaft>

    ## Kernaussagen

    - <Aussage 1>. [[<output_basename>#Page <N>|↗]]
    - <Aussage 2>. [[<output_basename>#^block-<M>|↗]]
    ...
  """
```

Tool appended automatisch `## Originaltext` mit dem geparsten Text.

## Step 2: Position-Marker pro Kernaussage (Pflicht)

Jede Kernaussage in `## Kernaussagen` traegt am Satzende einen Marker:

| Source-Typ | Marker-Form |
|---|---|
| PDF | `[[<output_basename>#Page <N>\|↗]]` -- N aus den `## Page N`-Headings im Originaltext |
| Markdown / Webclip | `[[<output_basename>#^block-<M>\|↗]]` |
| URL mit Section-IDs | `[[<output_basename>#<section-id>\|↗]]` |
| DOCX | `[[<output_basename>#^block-<M>\|↗]]` |
| PPTX | `[[<output_basename>#Slide <N>\|↗]]` |
| XLSX | `[[<output_basename>#Sheet <name>\|↗]]` |

Pflicht-Layout:

- Display-Text immer **nur** `↗`. Kein "Quelle:", kein "[1]".
- Inline am Satzende, ein Leerzeichen vor dem Link.
- Eine Block-Ref pro Kernaussage.

## Step 3: Verifikation

Tool gibt einen `Position-Marker check: X of Y Kernaussagen carry refs`-
String zurueck. Bei `X < Y`: lies die Note via `read_file`, ergaenze
fehlende Marker via `update_frontmatter`/`write_file`-Edit. **Nicht
die ganze Note neu schreiben.**

## Step 4: Sense-Making-Note (optional, User fragen)

Nach erfolgreichem Ingest **immer** via `ask_followup_question`-Tool
nachfragen, niemals als Plain-Text-Frage:

- question: "Soll ich aus den Kernaussagen Sense-Making-Notes anlegen?"
- options: ["Eine zusammenfassende Note", "Pro Take-Away einen eigenen
  Zettel", "Nichts, danke"]

Default ist "Nichts, danke". Nur bei expliziter Sense-Making- oder
Zettel-Antwort weiter mit Step 4a-4d.

### Step 4a: OKF-Frontmatter komponieren (pro Note)

Nimm den OKF-Frontmatter-Block (aus Step 0a, ggf. Inline-Default)
verbatim als String und befuelle die Werte. **Pflicht-Werte fuer
abgeleitete Notes:**

- `title`: Konzept-Titel (= Dateiname ohne `.md`).
- `description`: 1 Satz Deutsch, max 25 Woerter, Quintessenz des
  Take-Aways. **Nicht identisch mit dem Body** -- Frontmatter ist
  Suchbarkeit, Body ist Ausformulierung.
- `resource`: Wikilink basename-only zur Source-Mirror-Note
  (`"[[<Source-basename>]]"`). NICHT zur Original-PDF -- die
  Source-Mirror-Note ist die kanonische Verbindung zur Quelle.
  Source-Mirror NICHT zusaetzlich in `related:` aufnehmen
  (waere Redundanz).
- `tags`: 3-5 lowercase, bindestrich-verbunden.
- `type`: YAML-Liste -- erster Wert `- note` (Sense-Making) oder
  `- zettel` (einzelner Zettel). Zweiter Wert optional (inhaltlicher
  Subtyp).
- `moc`: 2-5 Themen/Konzept-Wikilinks. Vorher via `search_vault` nach
  vorhandenen Notes suchen.
- `related`: Wikilinks zu Personen (z.B. Autor der Source), Projekten,
  Meeting-Notes, anderen thematisch verbundenen Notes (kann leer
  bleiben, wenn keine relevante Verbindung).
- `timestamp`: Erstellungsdatum der Note.
- `uid`: leer.

Niemals YAML neu rendern -- das bricht das Frontmatter
(Doppel-`---`, verlorene Custom-Felder). Block ist String, Werte
hinter Doppelpunkten einsetzen.

### Step 4b: Naming-Konvention

Sense-Making-Note und Zettel sind **eigenstaendige Konzept-Notes** mit
aussagekraeftigen Titeln. Keinen Source-Basename als Prefix.

| ❌ Falsch | ✅ Richtig |
|---|---|
| `Karpathy ... -- Sense-Making.md` | `Karpathy zu Vibe Coding und Agentic Engineering.md` |
| `Karpathy ... -- LLMs als Ghosts.md` | `LLMs als Ghosts.md` |

Verbindung zur Quelle: Frontmatter `resource: "[[<Source>]]"` + Backlink
in der Source (Step 5).

### Step 4c (Modus A): Sense-Making-Note

EINE Note via `write_file`:

- **Pfad:** `<defaultOutputFolder>/<Konzept-Titel>.md`
- **Content (Reihenfolge strikt, keine Leerzeile vor dem Frontmatter):**

```
<OKF-FRONTMATTER VERBATIM, Werte gefuellt, type: - note>

# <Konzept-Titel>

## Kernaussage

<1-3 Saetze, zentrales Argument der Quelle pointiert.>

## Take-Aways

- <Take-Away 1, ausformuliert.> [[<Source>#Page <N>|↗]]
- <Take-Away 2.> [[<Source>#^block-<M>|↗]]
- ...
```

### Step 4d (Modus B): Multi-Zettel

Ein Zettel pro Take-Away via `write_file`:

- **Pfad:** `<defaultOutputFolder>/<Konzept-Titel>.md`
- **Content:**

```
<OKF-FRONTMATTER VERBATIM, Werte gefuellt, type: - zettel>

# <Konzept-Titel>

<EIN Gedanke / Take-Away, ausformuliert in 1-3 Absaetzen. Eigene
Worte, nicht Source-Wortlaut. Was ist die Insight, warum ist sie
relevant?>

## Quelle

[[<Source>]] -- siehe [[<Source>#Page <N>|↗]]
```

**Wichtig:** Body und Frontmatter-`description` ergaenzen sich.
`description` ist die Quintessenz fuer Listing/Suche, Body ist die
Ausformulierung. Niemals Body leer lassen.

**Namens-Kollision:** Wenn `<Konzept-Titel>.md` schon existiert,
`read_file` der existierenden Note, User fragen ob Ergaenzung oder
Variante (`<Titel> (<Autor>).md`). Nie stillschweigend ueberschreiben.

## Step 5: Backlink in der Quelle (Pflicht nach Step 4)

Wenn in Step 4 Notes erstellt wurden:

1. Lade die Quelle-Note via `read_file`.
2. **Verifikation:** Pruefe im Frontmatter, dass die Note als erstes
   `type`-Element `source` traegt. Wenn nicht, ist der Pfad falsch
   oder die Note ist die falsche -- STOP und frag den User, bevor du
   irgendwo `related:` setzt.
3. Lies das `related:`-Feld aus dem Frontmatter (vorhandene Werte).
4. `update_frontmatter`-Tool: setze `related:` auf eine YAML-Liste
   mit den gequoteten Wikilinks der neu erstellten Notes plus den
   bestehenden Eintraegen. Bestehende Werte beibehalten (append).
   ```yaml
   related:
     - "[[bestehender-eintrag]]"
     - "[[neue-note-1]]"
     - "[[neue-note-2]]"
   ```

   `update_frontmatter` macht REPLACE auf den Wert -- die VOLLSTAENDIGE
   Liste (alt + neu) gehoert mit ins `updates`-Objekt. Sonst gehen die
   alten Eintraege verloren.

Damit zeigt der Obsidian-Graph die Verbindung Quelle <-> abgeleitete
Notes ueber `related` und `resource` bidirektional.

## Verbote

- Keine `[1]`-Marker im Perplexity-Stil.
- Kein Multi-Turn-Dialog. Wenn Dialog noetig, ist `/ingest-deep`
  das richtige Skill.
- Kein Markdown-Mirror-Zwang fuer PDFs.
- Kein Originaltext in der `## Kernaussagen`-Section duplizieren.
- **Kein `read_document` vor `ingest_document`.** Tool parst selber.
- **Kein `list_files` zur Pfad-Suche.** User fragen ist billiger.
- **Keine neuen Ordner.** Erlaubte Ziele sind ausschliesslich
  `Attachements/` (Binaries) und `<defaultOutputFolder>/` (Markdown).
  Kein `Sources/`, kein `Notes/`.
- **Keine Source-Duplikate.** Liegt die Quelle bereits als Markdown im
  Vault (`source_path` zeigt auf eine `.md`-Datei), schreibe NICHT eine
  zweite Note in `<defaultOutputFolder>/` -- nutze stattdessen
  `update_frontmatter` + manuelle Block-ID-Edits direkt in der
  Original-Note.
- **Kein Source-Prefix in Sense-Making-/Zettel-Titeln.** Konzept-
  Titel sind eigenstaendig, die Verbindung zur Quelle steht im
  Frontmatter (`resource:`).
- **Kein YAML-Re-Render des OKF-Templates.** Frontmatter-Block ist ein
  verbatim String, Werte hinter Doppelpunkten einsetzen. Niemals
  zerlegen und neu zusammensetzen -- das produziert doppelte `---`
  und kaputte YAML.
- **Keine alten Templates lesen.** `Quelle Template.md`,
  `Zettel Template.md`, `Notiz Template.md` sind abgeloest. Nur
  `OKF Template.md` ist Master.
- **Keine alten Properties verwenden.** Mapping ist abschliessend:
  - `Zusammenfassung` -> `description` (1 Satz, max 25 Woerter)
  - `Autor` -> `related` als Person-Wikilink
  - `Jahr` -> `timestamp` (Veroeffentlichungsdatum als Datetime)
  - `URL` -> `resource`
  - `Notizen` -> `related`
  - `Themen` + `Konzepte` -> `moc`
  - `Meeting-Notizen` -> `related` (als Wikilink zur Meeting-Note)
  - `Projekte` -> `related` (als Wikilink zur Projekt-Note)
  - `Personen` -> `related` (als Wikilink zur Person-Note)
  - `Quellen` -> `resource` (Single-Source-Bindung)
  - `Kategorie` -> erster `type`-Eintrag
  - `Typ` -> zweiter `type`-Eintrag (inhaltlicher Subtyp)
  - `Permanent` -> entfaellt
  - `ISBN` -> entfaellt (Naming-Convention `Autor-Jahr_Titel` reicht)
- **Keine Transkript-Schnipsel als Note-Body.** Eigene Worte, ein
  klarer Gedanke pro Note. Roher Source-Text gehoert nicht in den
  Body -- referenziere via Block-Ref.
- **Wikilink-Properties ausschliesslich als YAML-Listen.** `moc`,
  `related`, `type` jede mit Eintraegen als Listen-Elementen,
  niemals als Komma-String. Block-Form
  (`moc:\n  - "[[X]]"\n  - "[[Y]]"`) oder Flow-Form
  (`moc: ["[[X]]", "[[Y]]"]`) sind beide ok; `moc: [[X]], [[Y]]`
  ist falsch und wird von Obsidian nicht als Liste geparsed. Auch ein
  einzelner Wert bleibt eine ein-elementige Liste.
- **Keine un-gequoteten Wikilinks.** `resource: [[Note]]` ohne Quotes
  ist invalid YAML. Immer `resource: "[[Note]]"`.
- **Keine un-gequoteten String-Werte.** `description: Gartner-Analyse...`
  ist ein Bug, selbst wenn der Text harmlos aussieht -- der naechste
  Doppelpunkt oder das naechste Komma bricht den Parser. Quotes um
  ALLE Strings.
- **Keine Uppercase-Tags.** `tags: AI-Agent` ist falsch. Immer
  lowercase: `tags: ai-agent`.

## Fehlerfaelle

| Fehler | Was tun |
|---|---|
| `Attachment index 0 out of range. 0 attachment(s) available.` | Attachment ist nicht (mehr) verfuegbar -- diesen Turn neu starten oder User um neues Upload bitten. Nicht retryen. |
| `File not found: <name>` | Pfad falsch. User fragen, nicht raten. |
| `File already exists: <output_path>` | output_path aendern (z.B. ` (2)` anhaengen) oder User fragen. |
| OKF Template nicht lesbar | Inline-Default oben verwenden, kein zweiter read_file-Versuch. |
