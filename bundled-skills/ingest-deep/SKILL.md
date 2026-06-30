---
name: ingest-deep
description: Deep ingest of a source (PDF/Markdown/URL/DOCX/PPTX/XLSX) in Karpathy multi-turn pattern. Forced Markdown conversion, OKF frontmatter, block-refs to the source rendered as a discreet ↗ symbol. Mandatory step 1 is triage (cluster match, source diversity, tension hint).
trigger: ingest.deep|deep.ingest|karpathy|sense.?making|multi.?turn.*ingest|tiefe.*ingest|deep.?dive.*quelle
source: bundled
requiredTools: [ingest_triage, ingest_deep, ingest_document, read_file, write_file, update_frontmatter, get_frontmatter, ask_followup_question, move_file]
---

# /ingest-deep -- Karpathy Multi-Turn Deep-Ingest

## TL;DR -- Pflicht-Workflow (lies das zuerst, in dieser Reihenfolge)

Egal ob die Quelle neu oder schon teilweise ingested ist, egal ob
Stub-Notes existieren: du folgst exakt dieser Sequenz, KEIN Schritt
darf uebersprungen werden.

**Erster Aufruf in jedem Run: `update_todo_list`** mit genau diesen
fuenf User-sichtbaren Steps (Labels strikt uebernehmen, keine eigenen
Plan-Labels erfinden):

```
1. Triage + Entscheidung (Ingest / Spaeter / Verwerfen)
2. Output-Modus + Themen-Auswahl
3. ingest_deep (Block-IDs in der Quelle setzen)
4. Sense-Making-Note oder Zettel schreiben
5. Backlinks in der Quelle setzen
```

Danach folgst du diesen Tool-Calls in dieser Reihenfolge:

1. **`ingest_triage`** auf die Quelle (Tool-Call).
2. **Triage-Karte + Empfehlung im Chat zeigen** (Text-Antwort).
3. **`ask_followup_question`** mit Optionen "Ingest / Spaeter / Verwerfen".
   STOPPE hier und warte auf User-Antwort.
4. **Themen-Tabelle im Chat zeigen** (Text-Antwort), aus den
   destillierten Insights der Quelle.
5. **`ask_followup_question`** "Welche Themen uebernehmen?"
   (Options: ["Alle"], Antwort als "Alle" oder Nummern-Liste).
   STOPPE und warte.
6. **`ask_followup_question`** Output-Modus (Sense-Making /
   Multi-Zettel / Nur Source-Note / Doch nicht ingesten).
   STOPPE und warte.
7. **`ingest_deep`** mit `output_mode="source-only"` und
   `block_anchors` aus den ausgewaehlten Themen (Tool-Call).
8. **`write_file`** fuer Sense-Making oder Zettel
   (1-N Tool-Calls je nach Modus). Entfaellt bei "Nur Source-Note".
9. **`update_frontmatter`** der Source-Note (`related:` += alle neuen
   Notes). Entfaellt bei "Nur Source-Note" / "Doch nicht ingesten".

**Existierende Stub-Notes (Notes, die schon vorhanden sind aber leer
oder fast leer):** Sie sind KEIN Resume-Trigger. Behandele sie wie
Namens-Kollisionen in Step 4: User via `ask_followup_question` fragen
ob ergaenzen oder Variante anlegen. Niemals stillschweigend mit
write_file ueberschreiben, niemals den Skill-Workflow ueberspringen
"weil es ja schon Notes gibt".

Details zu jedem Schritt unten. Aber: die obige 9-Punkt-Liste ist die
Wahrheit. Wenn du im Detail-Text etwas zu finden glaubst, das mit der
Liste konkurriert, gewinnt die Liste.

## Wann nutzen

Tiefe Sense-Making-Notes fuer Forschungs-PDFs, lange Webclips,
fachliche DOCX/PPTX, Zettelkasten-Material. Erwartung: 5-15 Minuten
Dialog, persistente Vault-Aenderungen, Block-genaue Provenance.

Nicht fuer schnelle Inbox-Aufnahme (-> /ingest), nicht fuer
Meeting-Transkripte (-> /meeting-summary).

## Kosten-Disziplin (vor jedem Tool-Call lesen)

Karpathy-Multi-Turn ist teuer. Halte den Token-Verbrauch klein:

- **Maximal 2 Tool-Calls vor dem User-Approval, maximal 1 Tool-Call
  beim eigentlichen Schreiben.** Bei 32 Messages und einem 410-Seiten-PDF
  im Kontext kostet ein einziger Run > 10 EUR.
- **STOP-on-Error.** Wenn ein Tool fehlschlaegt, brich ab und sag dem
  User was er tun soll. Nicht in Retry-Loops verfallen.
- **Keine Erkundungs-`read_document`-Calls.** Quelle wurde dem Agent
  schon als `<attached_document>` oder Vault-File gegeben.
- **Kein `list_files` als Workaround.** Wenn der Pfad unklar ist,
  frag den User.

## Sprache, Stil und Zeichensatz

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
  - **Body** (Kernaussage, Take-Aways, Zettel-Body) bei deutscher
    Source.
  - **Markdown-Reproduktion der Quelle** (Source-Mirror): wenn der
    Source-Text deutsch ist, muessen ä/ö/ü/ß im erzeugten Markdown
    erhalten bleiben. Falls der PDF-Parser fehlerhafte
    Substitutionen liefert (haeufig "ae" statt "ä", "ss" statt "ß"),
    die Umlaute in Frontmatter, Overview und Kernaussagen vor dem
    Speichern korrigieren. Im automatisch angefuegten `## Originaltext`-
    Block bleibt der Tool-Output unveraendert; alles vom Skill
    selbst Geschriebene wird korrigiert.
  - **Ausnahmen:** Eigennamen, Identifier, Pfade und englische
    Begriffe bleiben unveraendert (z.B. "Anthropic", "Foundation",
    "src/path/foo.ts").
- **Keine em-dashes (—) und keine en-dashes (–).** Stattdessen Punkt,
  Komma, Klammer oder Worte wie "und", "aber", "also". Gilt sowohl
  fuer Chat-Antworten als auch fuer den Body / das Frontmatter der
  erzeugten Notes.
- **Keine generischen AI-Floskeln:** kein "landscape", "leverage",
  "robust", "seamless", "delve", "crucial", "nuanced", "holistic",
  "foster", "ensuring", "highlighting", "underscoring". Aktive
  Stimme, konkrete Worte.
- **Sense-Making-Notes und Zettel (Step 4): /humanizer-Regeln Pflicht.**
  Diese Notes sind Eigentext des Skills, kein Source-Zitat -- sie
  muessen wie von einem Menschen geschrieben klingen. Anwenden:
  - Keine aufgeblaehte Symbolik, keine Fueller, keine Meta-Signposting
    ("Hier sehen wir, dass...", "Es ist wichtig zu erwaehnen, dass...",
    "Im Folgenden wird gezeigt...").
  - Keine negativen Parallelismen ("nicht X, sondern Y").
  - Keine "Rule of three" (drei rhetorische Aufzaehlungen am Stueck).
  - Keine vagen Attributionen ("Studien zeigen", "Experten sagen") --
    konkret werden, der `[[<Source>]]`-Backlink zitiert ohnehin
    konkret.
  - Sentence Case in Ueberschriften, aktive Stimme, konkrete
    Substantive statt Nominalisierungen.
  - Vor dem `write_file` jeden Zettel/Sense-Making-Body mental gegen
    diese Regeln pruefen und ueberarbeiten.

## Frontmatter-Master: OKF Template (Pflicht)

Alle Notes -- Source-Mirror, Sense-Making, Zettel, MOC -- nutzen
ausschliesslich das **OKF Template** als Frontmatter-Vorlage:

`Tools & Settings/Templates/OKF Template.md`

Andere Templates (`Quelle Template.md`, `Zettel Template.md`,
`Notiz Template.md`) sind abgeloest und werden nicht mehr gelesen.

## Vorbereitung (interner Step -- NICHT in update_todo_list aufnehmen)

Diese Vorbereitung ist Skill-intern und wird vom User nicht im Plan
gesehen. Das Plugin-UI zeigt nur die Steps 1-5; "Templates lesen"
laeuft still im Hintergrund.

**Obsidian-Settings lesen:**

`read_file path=".obsidian/app.json"` und merke dir aus dem JSON:

- `attachmentFolderPath` -- Zielordner fuer Binaries (PDF/DOCX/PPTX/XLSX).
  Default `Attachements/`. **NIEMALS hardcoden**, immer aus app.json.
- `newFileFolderPath` -- Zielordner fuer neue Markdown-Notes
  (Source-Mirror, Sense-Making, Zettel). Default `Inbox/`.

Diese zwei Pfade ersetzen ueberall im Skill `<attachmentFolderPath>`
und `<defaultOutputFolder>`.

**Naming-Convention lesen (Pflicht):**

`read_file path="Tools & Settings/Templates/Dateinamens-Konventionen.md"`
und uebernimm das dort dokumentierte Schema fuer ALLE Notes und
Binaries, die der Skill erzeugt oder verschiebt. Kurzfassung:

- **Quellen / Binaries:** `Autor-Jahr_Titel.<ext>` (z.B.
  `Gibson-2026_How-AI-Changes-the-IT-Operating-Model.pdf`).
  Bindestrich zwischen Autor und Jahr, **Unterstrich** zwischen Jahr
  und Titel, Bindestriche innerhalb des Titels.
- **Mehrere Autoren:** `Autor1-und-Autor2-Jahr_Titel` oder
  `Autor-et-al-Jahr_Titel`.
- **Kein Autor:** Organisationsname statt Autor
  (`ZDF-2024_Lanz-Interview-Baerbock.md`).
- **Sense-Making / Zettel / MOC:** keine strenge Regel, lesbarer
  Konzept-Titel (`Jagged Intelligence.md`, `LLMs als Ghosts.md`).
- **Keine Leerzeichen** in Binaries und Quellennotizen, keine
  Sonderzeichen ausser `-` und `_`.

Falls die Konvention-Note fehlt: nutze die Kurzfassung oben. Niemals
das alte Schema `Autor-Jahr-Titel` (drei Bindestriche) verwenden --
das fehlt der Underscore und bricht Sebastians Sortierung.

**OKF Template lesen:**

`read_file path="Tools & Settings/Templates/OKF Template.md"`.

Aus dem Template den Frontmatter-Block zwischen den beiden `---`-
Zeilen extrahieren. **Achtung:** Das OKF Template schliesst mit
`---\n---\n` (zwei Trenner direkt hintereinander). Nimm nur den
ERSTEN Frontmatter-Block, ignoriere das zweite `---`. Der
Template-Block ist ein verbatim String der dann pro write_file mit
Werten befuellt wird.

Wenn der Pfad fehlschlaegt, nicht retryen, nicht andere Pfade
durchprobieren -- nutze den Inline-Default unten.

**Inline-Default (Fallback wenn Template-Read fehlschlaegt):**

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

### Frontmatter-Hygiene (Pflicht fuer JEDE Note die der Skill erzeugt)

Gilt fuer alle Frontmatter-Bloecke -- ob `ingest_document`-Mirror,
Sense-Making-Note, Zettel oder MOC-Stub. Nicht nur Step 4.

1. **`type` -- YAML-Liste mit 1-2 Eintraegen.**
   - **Erster Eintrag (Pflicht): Note-Kategorie.** Genau einer aus:
     - `- source` -- Source-Mirror (PDF/DOCX/PPTX/XLSX/URL-Markdown).
       Der Mirror ist die Quelle.
     - `- note` -- Sense-Making-Note (eine zusammenfassende Note ueber
       mehrere Take-Aways).
     - `- zettel` -- Multi-Zettel-Note (atomarer Zettel, ein Gedanke
       pro Note).
     - `- moc` -- MOC-Stub (wenn der User in Step 5 zustimmt, einen
       neuen Cluster-Hub anzulegen).
     - `- person` -- Person-Note (z.B. Autor einer Quelle).
     - `- project` -- Projekt-Note.
     - `- meeting` -- Meeting-Note.
   - **Zweiter Eintrag (optional): inhaltlicher Subtyp.** Beschreibt
     genauer was die Quelle ist:
     - `- Analyst Report` (z.B. Gartner, Forrester)
     - `- Interview`, `- Talk`, `- Podcast`
     - `- Blog Post`, `- Webclip`, `- Newsletter`
     - `- Buch`, `- Paper`, `- Whitepaper`, `- Studie`
     - `- Slide Deck`
     - oder ein anderer treffender Begriff.

   Beispiel Source-Mirror:
   ```yaml
   type:
     - source
     - Analyst Report
   ```
   Beispiel Multi-Zettel:
   ```yaml
   type:
     - zettel
   ```
   Nie als Inline-Array `[source, Analyst Report]` -- das matcht den
   Auto-Trigger nicht.

2. **ALLE String-Werte IMMER doppel-gequotet.** Keine Ausnahmen, keine
   "wenn"-Klauseln, keine Pruefung ob Sonderzeichen drin sind. Strings
   sind alle Werte hinter einem Doppelpunkt, die KEINE der folgenden
   Sonderformen sind:
   - YAML-Liste (`- ...` darunter eingerueckt)
   - Boolean (`true`, `false`)
   - Zahl (`42`, `2026`)
   - Leerer Wert (Feld ohne Inhalt)

   Beispiel:
   ```yaml
   title: "Gibson-2026_How-AI-Changes-the-IT-Operating-Model"
   description: "Gartner-Analyse von Miles Gibson zur Frage, wie KI das IT-Betriebsmodell veraendert."
   resource: "https://www.gartner.com/document/code/846639"
   timestamp: "2026-04-15T00:00:00"
   ```

   Innerhalb von gequoteten Strings escape `"` mit `\"`. Quotes um
   das Feld, nicht um die ganze Zeile.

   **Verbot:** Nie ein String-Feld ohne Quotes. `description:
   Gartner-Analyse...` ist ein Bug, selbst wenn der Text harmlos
   aussieht -- der naechste Doppelpunkt oder das naechste Komma bricht
   den Parser.

3. **`moc` als YAML-Liste aus Wikilinks (Pflicht):** 2-5 Eintraege,
   jeder ein gequoteter Wikilink, damit der Obsidian-Graph eine Kante
   zur Themen-/Konzept-Note hat:
   ```yaml
   moc:
     - "[[LLMs]]"
     - "[[Jagged Intelligence]]"
     - "[[Agentic Engineering]]"
   ```
   Komma-getrennt oder ohne Wikilinks bedeutet: keine Graph-Kante,
   kein Anschluss an MOCs / Theme-Hubs.

   **STRIKT: `moc` nimmt AUSSCHLIESSLICH Wikilinks auf Notes mit
   `type: - topic` oder `type: - concept` auf.** Alles andere
   (Projekte, Personen, andere Quellen, abgeleitete Notes, Tools,
   Meetings, MOCs anderer Hierarchien) gehoert nach `related:`.

   **Verifikation Pflicht vor write_file:** fuer jeden Kandidaten-
   Wikilink im `moc:`-Feld eine kurze `get_frontmatter`-Pruefung
   machen:
   - Existiert die Ziel-Note? Wenn nein -> Wikilink darf trotzdem
     in `moc:` (Unresolved Link, der Wert wird als Topic-Candidate
     angelegt) -- aber nur wenn der Konzept-Titel klar ein Thema
     oder Konzept ist (z.B. `[[Verifiability]]`, `[[Agentic AI]]`).
     Konkrete Personen-Namen, Projekt-Namen oder Tool-Namen niemals
     in `moc:` als Unresolved Link platzieren -- die gehoeren in
     `related:`.
   - Existiert die Ziel-Note? Wenn ja -> `type:`-Feld lesen.
     - Erster Eintrag `topic` oder `concept` -> Wikilink bleibt in `moc:`.
     - Alles andere (`note`, `zettel`, `source`, `person`, `project`,
       `meeting`, `moc`, `tool`) -> Wikilink nach `related:` verschieben.

   Wenn die Triage-Karte "Verwandte Notes" mit gemischten Types
   liefert, sortiert der Skill sie beim Schreiben des Frontmatters
   nach Ziel-Type in `moc:` (topic/concept) und `related:` (Rest) auf.

   **Triage-Karten-Verarbeitung (Pflicht, mit Type-Sortierung):**
   Die Triage-Karte (Step 1) liefert Vorschlaege. Sortiere sie nach
   Ziel-Note-Type, BEVOR du das Frontmatter schreibst:
   - `Cluster-Match` aus der Ontologie -> normalerweise `moc:`
     (Cluster sind per Definition Topics/Concepts).
   - Jeder Eintrag aus `Verwandte Notes (Vault)` -> via
     `get_frontmatter` den `type:`-ersten-Wert lesen:
     - `topic` / `concept` -> in `moc:`
     - `note` / `zettel` / `source` / `person` / `project` /
       `meeting` / `moc` / `tool` -> in `related:`
   - Thematische Hubs des Konzept-Titels (z.B. "Jagged Intelligence"
     ist ein Konzept) -> als Wikilink in `moc:`, auch ohne Triage-Hit.

   Diese Verlinkung ist **das Hauptdeliverable** des Skills neben den
   Notes selber. Wenn die Triage 5 verwandte Notes gefunden hat und
   davon 3 vom type `note`/`source`, 2 vom type `topic`, ist das
   Pflicht-Ergebnis: 2 Eintraege in `moc:`, 3 in `related:`.
   Auslassung waere unvollstaendiger Run -- pruefe vor
   `attempt_completion`.

   **Vorhandene moc-Notes bevorzugt nutzen:** Wenn die Triage-Karte
   passende Notes nennt oder ein Konzept eindeutig zu einer bestehenden
   MOC gehoert, dort verlinken. Nur wenn keine passende Note existiert,
   einen neuen Wikilink schreiben -- Obsidian zeigt das als "Unresolved
   Link" (gepunkteter Knoten im Graph).

   **Unresolved Links sind OK:** Am Ende des Runs (vor
   `attempt_completion`): gib eine kurze Uebersicht der neuen
   Unresolved Links: "Neue Cluster-Vorschlaege: [[X]], [[Y]] -- als
   MOC anlegen?" via `ask_followup_question`. Bei Ja: schreibe eine
   Stub-MOC-Note (`<defaultOutputFolder>/<Cluster>.md`) mit OKF-
   Frontmatter (`type: - moc`) und einem Base-Codeblock, der alle
   Notes mit `moc: "[[<Cluster>]]"` listet.

4. **`related` als YAML-Liste aus Wikilinks zu konkreten Notes mit
   relevanter Verbindung.** Hier kommen rein:
   - **Personen** (Pflicht bei Source-Mirror: Autor der Quelle, plus
     weitere relevante Personen). Jeder Wikilink zeigt auf eine
     Person-Note (`type: - person`). Wenn die Person-Note noch nicht
     existiert: Wikilink trotzdem schreiben (Unresolved Link),
     Obsidian zeigt den gepunkteten Knoten und der User kann die
     Person-Note spaeter befuellen.
   - **Projekte** (`type: - project`) als Wikilink.
   - **Meeting-Notes** (`type: - meeting`) als Wikilink.
   - **Andere thematisch verbundene Notes** (Sense-Making, Zettel,
     andere Sources).
   - Bei Source-Mirror: **alle abgeleiteten Sense-Making-/Zettel-
     Notes** (wird in Step 5 ergaenzt).

   **Bei Sense-Making / Zettel: Source-Mirror NICHT in `related`
   wiederholen.** Die Source-Mirror-Note steht bereits im `resource:`-
   Feld -- das ist die kanonische Verbindung. Ein zusaetzlicher
   Wikilink in `related:` waere Redundanz und macht den Graph
   unleserlich. Auch wenn die Triage-Karte die Source-Mirror-Note
   als "Verwandte Note" auflistet, gehoert sie nicht in `related:`
   einer abgeleiteten Note. Filter sie raus beim Sortieren.

   Beispiel Source-Mirror nach Step 5:
   ```yaml
   related:
     - "[[Miles Gibson]]"
     - "[[LLMs als Ghosts]]"
     - "[[Trust als IT-Deliverable]]"
   ```

   Beispiel Zettel:
   ```yaml
   related:
     - "[[Miles Gibson]]"
     - "[[Andere Zettel-Note]]"
   ```

   **Abgrenzung `moc` vs. `related`:** `moc` ist die Taxonomie
   (Themen/Konzept-Hubs, Map of Content -- breite thematische
   Einordnung). `related` ist die konkrete Verbindung zu einzelnen
   anderen Notes (Personen, Projekte, andere Quellen, abgeleitete
   Notes).

5. **`resource`** -- Link zur Original-Quelle. **Pflicht-Form je
   Note-Typ:**
   - **Source-Mirror Binary (`type: - source` mit PDF/DOCX/PPTX/XLSX):**
     **Markdown-Link** mit explizitem Vault-Pfad und URL-Encoded
     Leerzeichen, NICHT Wikilink. Label-Text ist der vollstaendige
     **Dateiname inkl. Extension** (nicht "Original-PDF" oder
     Aehnliches). Format:
     `resource: "[<dateiname.ext>](<vault-path-mit-url-encoded-spaces>)"`.
     Beispiele:
     - `resource: "[Gibson-2026_How-AI-Changes-the-IT-Operating-Model.pdf](attachments/Gibson-2026_How-AI-Changes-the-IT-Operating-Model.pdf)"`
     - `resource: "[2024-Strategy Notes.docx](Attachements/2024-Strategy%20Notes.docx)"`

     Begruendung: Wikilinks zu Non-MD-Dateien in YAML-Properties
     resolven inkonsistent, vor allem wenn ein Vault parallel mehrere
     Attachment-Folder-Schreibweisen (`attachments/`, `Attachments/`,
     `Attachements/`) hat. Markdown-Links umgehen den
     Shortest-Path-Resolver und sind garantiert klickbar.

     Das Plugin (PdfMarkdownMirror) setzt diesen Wert bei PDF-Mirror-
     Erstellung automatisch. Skill darf bei `update_frontmatter`
     ueberschreiben, aber nur mit derselben Markdown-Link-Form.
   - **Webclip / URL-Source (`type: - source` ohne Binary):** URL als
     gequoteter String (`resource: "https://..."`).
   - **Markdown-only Quelle (kein Original-Binary):** leer lassen.
   - **Sense-Making / Zettel (`type: - note` / `- zettel`):**
     **Wikilink basename-only** zur Source-Mirror-Note (das ist eine
     .md-Datei, da funktioniert Wikilink zuverlaessig):
     `resource: "[[Gibson-2026_How-AI-Changes-the-IT-Operating-Model]]"`

   **Verbot:** Wikilinks zu Binaries (`[[file.pdf]]`) im `resource:`-
   Feld. PDF/DOCX/PPTX/XLSX immer als Markdown-Link, niemals als
   Wikilink.

6. **`tags` (Format-Regeln strikt):**
   - YAML-Liste mit `- ` Prefix.
   - 3-5 Eintraege, exakt fuer Suchbarkeit.
   - Alle **lowercase**, auch Akronyme und Eigennamen.
   - Mehr-Wort-Begriffe per Bindestrich verbunden, max 2 verbundene
     Woerter pro Keyword (`ai-agent`, `rag`, `obsidian-workflow`,
     `prompt-engineering`).
   - Deutsch und Englisch mischen, englische Variante bevorzugen wenn
     gebraeuchlicher.
   - Beispiel:
     ```yaml
     tags:
       - ai-transformation
       - cio-leadership
       - it-operating-model
       - gartner
     ```

7. **`description`:** 1 Satz auf Deutsch, max 25 Woerter. **Nicht
   identisch mit dem Body** der abgeleiteten Notes -- Frontmatter ist
   Suchbarkeit, Body ist Ausformulierung. Bei Sources die Quintessenz
   der Quelle, bei abgeleiteten Notes die Quintessenz des Take-Aways.

8. **`timestamp`:** ISO-Datetime, gequotet
   (`"2026-06-29T12:00:00"`). **Vollstaendiges Datum (YYYY-MM-DD)**,
   nicht nur Jahr. Wenn nur das Jahr bekannt ist, im Source-Text
   nach Tag und Monat suchen (Abgabedatum, Erscheinungsdatum,
   Publication date, Copyright-Jahr mit Monat, Konferenz-Datum,
   Issue-Datum, Header/Footer der ersten Seiten). Erst wenn nirgends
   ein praeziseres Datum steht, auf `YYYY-01-01T00:00:00` defaulten.
   - **Source (`type: - source`):** Veroeffentlichungsdatum der
     Quelle. Beispiele:
     - PDF mit "Abgabedatum: 03.09.2025" -> `"2025-09-03T00:00:00"`.
     - Blog Post "Published Jan 15, 2026" -> `"2026-01-15T00:00:00"`.
     - Buch mit Copyright "2024" und Vorwort "Hamburg, Maerz 2024" ->
       `"2024-03-01T00:00:00"`.
     - Analyst Report "15 April 2026" -> `"2026-04-15T00:00:00"`.
   - **Meeting:** Datum des Meetings.
   - **Sense-Making / Zettel / MOC:** Erstellungsdatum der Note (das
     aktuelle Datum -- Konstruktion via String, KEIN `new Date()`-Aufruf).

9. **`title`:** der Konzept-Titel der Note (= Dateiname ohne `.md`).
   Bei Source-Mirror: `Autor-Jahr_Titel` (Naming-Convention). Bei
   Sense-Making/Zettel: sprechender Konzept-Titel.

10. **Leere Felder nicht entfernen.** Das Template enthaelt absichtlich
    leere Slots -- der User fuellt die spaeter manuell. Stehen lassen.

11. **`uid:` Feld:** leer lassen. Wenn ein UID-Plugin installiert und
    per Auto-Generation konfiguriert ist (typisch via vault.on-create),
    uebernimmt das Plugin den Wert nach dem Schreiben automatisch.

**UID-Plugin:** Wir steuern es nicht aus dem Skill heraus. Wenn der
User ein UID-Plugin (z.B. `note_uid_generator`) mit Auto-Generation
konfiguriert hat, befuellt das Plugin das `uid:`-Feld eigenstaendig
beim Note-Create. Skill schreibt `uid:` leer und macht keine
`execute_command`-/`call_plugin_api`-Aufrufe dazu.

**Konkretes Beispiel: Source-Mirror einer PDF (PFLICHT-FORMAT):**

```yaml
---
title: "Gibson-2026_How-AI-Changes-the-IT-Operating-Model"
description: "Gartner-Analyse von Miles Gibson zur Frage, wie KI das IT-Betriebsmodell von CIOs veraendert."
resource: "[Gibson-2026_How-AI-Changes-the-IT-Operating-Model.pdf](attachments/Gibson-2026_How-AI-Changes-the-IT-Operating-Model.pdf)"
tags:
  - ai-transformation
  - cio-leadership
  - it-operating-model
  - gartner
type:
  - source
  - Analyst Report
moc:
  - "[[IT Operating Model]]"
  - "[[AI Transformation]]"
  - "[[CIO Leadership]]"
  - "[[Co-Leadership]]"
  - "[[Fusion Teams]]"
related:
  - "[[Miles Gibson]]"
  - "[[Gartner Strategy Q2 2026]]"
timestamp: "2026-04-15T00:00:00"
uid:
---
```

**Konkretes Beispiel: Multi-Zettel-Note:**

```yaml
---
title: "Trust als IT-Deliverable"
description: "Vertrauen wird zur messbaren Leistung der IT-Abteilung, nicht zur weichen Beigabe."
resource: "[[Gibson-2026_How-AI-Changes-the-IT-Operating-Model]]"
tags:
  - trust
  - it-deliverable
  - governance
type:
  - zettel
moc:
  - "[[IT Operating Model]]"
  - "[[Vertrauen in KI-Systeme]]"
related:
  - "[[Miles Gibson]]"
timestamp: "2026-06-29T14:30:00"
uid:
---
```

## Step 0: Source-Typ erkennen (Pflicht, vor allem anderen)

Quelle kommt entweder als **Chat-Attachment** (User hat eine Datei in
den Chat gezogen) oder als **Vault-File** (Datei liegt schon im Vault).
Das macht einen riesigen Unterschied fuer die naechsten Schritte.

| Indikator | Source-Typ |
|---|---|
| `<attached_document name="..." format="pdf" pages="N">` ohne `vault_path`-Attribute | **Chat-Attachment** |
| `<attached_document ... vault_path="...">` | **Vault-File** (mit attachment-Hint) |
| User hat einen vault-relativen Pfad genannt (z.B. `Attachements/Foo.pdf`) | **Vault-File** |
| Keine der obigen Indikatoren | Nachfragen |

### Step 0a (Chat-Attachment): erst in Vault speichern

Chat-Attachments leben **nur einen Turn**. Der `attachment_index` ist
ab Turn 2 nicht mehr gueltig. Fuer Karpathy-Multi-Turn brauchst du
also einen Vault-Pfad VOR dem Dialog.

**Ablage-Regel (verbindlich):**

| Source-Typ | Ablage-Pfad |
|---|---|
| PDF | Original-PDF nach `<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.pdf`. `ingest_document` (bzw. `ingest_deep` mit pdf-mirror) erzeugt zusaetzlich einen Markdown-Mirror in `<newFileFolderPath>/<Autor>-<Jahr>_<Titel>.md`. |
| DOCX / PPTX / XLSX | Original nach `<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.<ext>`, Markdown-Arbeitsnote nach `<newFileFolderPath>/`. |
| Markdown / Webclip | Direkt nach `<newFileFolderPath>/<Autor>-<Jahr>_<Titel>.md`. Keine `Attachements/`-Kopie. |

`<attachmentFolderPath>` und `<newFileFolderPath>` kommen aus der
Vorbereitung (`.obsidian/app.json`), NICHT hardcoden.

**Filename-Convention -- aus `Tools & Settings/Templates/Dateinamens-Konventionen.md`:**

`Autor-Jahr_Titel.<ext>` mit Bindestrich zwischen Autor und Jahr,
**Unterstrich** zwischen Jahr und Titel, Bindestriche innerhalb des
Titels. Beispiel: `Gibson-2026_How-AI-Changes-the-IT-Operating-Model.pdf`.
Kein Leerzeichen, keine Sonderzeichen ausser `-` und `_`.

Vorgehen:

1. Bestimme den richtigen Filename gemaess Naming-Convention.

2. **Chat-Attachment-Binaries werden automatisch im Vault abgelegt.**
   Der AttachmentHandler legt PDFs/DOCX/XLSX beim Drop direkt in
   `<attachmentFolderPath>` ab und reicht den Pfad im
   `<attached_document vault_path="...">`-Attribut weiter. **Lies das
   `vault_path`-Attribut, das ist der aktuelle Pfad der PDF.**

3. **Pfad-Tabelle (verbindlich, niemals verwechseln):**

   | Datei | Aktueller Pfad | Zielpfad nach diesem Step |
   |---|---|---|
   | Original-PDF (.pdf) | `<vault_path>` aus dem Attachment | `<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.pdf` |
   | Markdown-Mirror (.md) | wird erst in Step 4 erzeugt | `<newFileFolderPath>/<Autor>-<Jahr>_<Titel>.md` |

   `<attachmentFolderPath>` = `Attachements/` (oder was in `app.json`
   steht). Da gehoeren NUR Binaries hin (`.pdf`, `.docx`, `.xlsx`).
   `<newFileFolderPath>` = `Inbox/`. Da gehoeren NUR Markdown-Notes
   hin. **Niemals einen `.md`-Mirror nach Attachements verschieben
   und niemals eine `.pdf` nach Inbox.**

4. **PDF an die Convention bringen (move_file):**
   - Wenn `vault_path` schon `<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.pdf`
     ist: nichts zu tun.
   - Wenn nicht (anderer Ordner oder anderer Name): `move_file source=<vault_path>
     destination=<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.pdf`.
   - **Wenn `vault_path` leer ist (PDF nicht im Vault):** STOPP. Frag
     den User via `ask_followup_question` "Die PDF konnte nicht
     automatisch ins Vault gespeichert werden -- bitte ziehe sie
     manuell nach `<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.pdf`
     und melde dich". **Niemals stattdessen den Markdown-Mirror nach
     Attachements verschieben -- das verwechselt Binary und Mirror.**

5. **Markdown-Mirror erzeugen (`ingest_document`):**
   ```
   ingest_document
     source_path="<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.pdf"
     output_path="<newFileFolderPath>/<Autor>-<Jahr>_<Titel>.md"
     header_content="<OKF-FRONTMATTER VERBATIM, type: - source, resource: \"[<dateiname.pdf>](<vault-path-zur-pdf>)\" (Markdown-Link mit Dateiname als Label, KEIN Wikilink fuer PDF)>"
   ```
   `source_path` zeigt auf das **`.pdf` im Attachments-Folder**,
   `output_path` ist die **`.md` im Inbox-Folder**. Diese Zuordnung
   ist umgekehrt, wenn du sie verwechselst landet der Mirror in
   Attachements (Bug!) oder das PDF in Inbox (auch Bug).

6. **`header_content` muss Frontmatter-Hygiene einhalten** (siehe oben).
   Konkretes Beispiel siehe "Konkretes Beispiel: Source-Mirror einer
   PDF". Jedes String-Feld in Quotes, `type: - source`, `resource` als
   Wikilink zum PDF, `moc` und `tags` aus dem Source-Inhalt abgeleitet.

7. Nach erfolgreichem Save: weiter mit Step 1 auf Vault-Basis.

**Kein Versuch**, im naechsten Turn nochmal `attachment_index 0` zu
nutzen. Es wird fehlschlagen.

### Step 0b (Vault-File): direkt weiter

Continue mit Step 1.

## Step 1: Triage + Decision (Pflicht-Sequenz, drei Aktionen)

Step 1 besteht aus genau drei Aktionen, alle drei sind Pflicht, KEINE
darf uebersprungen werden. Wenn du nach Aktion 1 direkt zu Step 2
gehst, hast du den User uebergangen.

**Aktion 1: `ingest_triage` aufrufen.**
**Aktion 2: Karte + Empfehlung im Chat an den User zeigen.**
**Aktion 3: `ask_followup_question` stellen, auf Antwort warten.**

---

### Aktion 1: `ingest_triage` aufrufen

Tool: `ingest_triage`

```
ingest_triage
  source_uri="vault://<path>"
  query="<2-5 zentrale Themen / Konzepte aus der Quelle, kommagetrennt>"
```

**Voraussetzung:** Source ist ein Vault-File. Bei Chat-Attachments
hat Step 0a die Datei bereits in den Vault gespeichert.

**`query` ist Pflicht-Parameter fuer eine echte Triage.** Der Tool
durchsucht damit Vault (semantic index), Memory (Facts) und History
(past chats), damit die Triage-Karte verwandten Kontext aus dem
gesamten Wissensbestand zeigt -- nicht nur Cluster-Klassifikation der
einen Datei. Ohne `query` fallback auf basename + Frontmatter-Themen,
das ist meist zu unscharf. Leite die Query aus dem
`<attached_document>`- oder Note-Body ab (Titel + Hauptthemen).

**URI-Format strikt:**

| Quelle | Korrekte URI | Falsch (wird abgelehnt) |
|---|---|---|
| Vault-File | `vault://Attachements/foo.pdf` | `file:///foo.pdf` |
| Vault-Note | `vault://Notes/foo.md` | `foo.md` |
| Webclip | `https://example.com/x` | `example.com/x` |

`file://`-URIs werden vom Tool abgelehnt: Chat-Attachments leben nur
einen Turn, jeder spaetere Read schlaegt zwingend fehl. Wenn die
Datei nicht im Vault liegt -> erst Step 0a (in Vault speichern), nicht
mit `file://` triagen.

Output ist eine Triage-Karte:

- Cluster-Match aus der Ontologie
- Source-Domain-Diversity-Hint
- **Verwandte Notes (Vault)** -- top-K aus semantic index
- **Verwandte Facts (Memory)** -- token-overlap im Fact-Store
- **Verwandte Chats (History)** -- LIKE-Match in past conversations
- Empfehlung: Ingest / Spaeter / Verwerfen

---

### Aktion 2: Karte + Empfehlung im Chat zeigen

Zeig die Karte dem User -- inklusive der drei Recherche-Bloecke.
**Direkt danach formulierst du eine eigene Empfehlung** (nicht nur
"hier ist die Karte"). Format:

> **Empfehlung: <Ingest | Spaeter | Verwerfen>**
>
> _<2-3 Saetze Begruendung, die auf die konkreten Hits aus der Karte
> referenziert.>_
>
> - **Anschluss-Punkte:** <welche bestehenden Notes / Facts / Chats
>   schliessen direkt an? Konkret benennen, mit `[[Wikilinks]]`.>
> - **Luecken / Mehrwert:** <was im Vault noch nicht gibt, was diese
>   Quelle bringen wuerde.>
> - **Risiken:** <Echo-Chamber (Source-Diversity-Warnung), Dubletten
>   (gleiche Source schon ingested), Widersprueche zu Bestand.>

Beispiele:

- _Empfehlung: Ingest. Karpathy-Talk uebersetzt das LLM-Mental-Model
  von "Tier" auf "Ghost"; das ergaenzt deine bestehenden Notes zu
  [[Coding Agents]] und [[GitHub Copilot Beast Mode v3.1]] um die
  konzeptionelle Klammer. Anschluss an Memory-Fact "5x-Multiplikator
  ohne Coding Agents". Luecke: kein Material zu "Verifiability als
  Engineering-Skill". Risiko: gering, andere Karpathy-Talks im Vault
  decken den Software-3.0-Aspekt schon ab._
- _Empfehlung: Spaeter. Cluster bereits 4 Notes aus medium.com,
  Source-Diversity-Warnung 80%. Erst gegenposition-Material aus
  primaeren Quellen suchen._

---

### Aktion 3: Decision via `ask_followup_question` (Pflicht, kein Skip)

Decision nach der Empfehlung **IMMER via `ask_followup_question`**.
Auch wenn die Empfehlung "Ingest" lautet, auch wenn die Quelle in
einem frueheren Run schon teilweise ingested wurde, auch wenn der
User /ingest-deep selbst aufgerufen hat -- du wartest auf seine
explizite Entscheidung:

```
ask_followup_question
  question: "Wie weiter mit dieser Quelle?"
  options: ["Ingest (Empfehlung folgen)", "Spaeter", "Verwerfen"]
```

**Du machst KEINE Tool-Calls fuer Step 2 oder spaeter, bevor diese
ask_followup_question gelaufen ist und der User geantwortet hat.**
Schick die `ask_followup_question` und stoppe. Nicht direkt
hinterher Tool-Calls queueen.

Der `/ingest-deep`-Aufruf ist die Absicht, einen Ingest-Workflow zu
starten -- nicht die Zustimmung, den Ingest tatsaechlich durchzufuehren.
Die Triage-Empfehlung kann die Entscheidung umdrehen ("Spaeter" wegen
Echo-Chamber-Risiko, "Verwerfen" weil schon vollstaendig ingested).

- **Ingest** -> Step 2.
- **Spaeter** -> Skill-Abbruch mit folgenden persistenten Effekten:
  - Triage-Log behaelt die Decision "spaeter" (das hat `ingest_triage`
    schon erledigt -- nicht erneut aufrufen).
  - Die Quelle bleibt unangetastet in ihrem aktuellen Folder (z.B. Inbox).
  - Keine derived Notes, kein Frontmatter-Update.
  - Beim naechsten `/ingest-deep`-Aufruf auf dieselbe Quelle zeigt die
    Triage-Karte "bereits triaged (spaeter)" und der User kann die
    Decision aendern. Sag dem User in der Abschluss-Antwort kurz:
    "Auf 'spaeter' gesetzt -- die Quelle bleibt in {Folder}. Beim
    naechsten /ingest-deep kannst du erneut entscheiden."
- **Verwerfen** -> Skill-Abbruch:
  - Triage-Log behaelt die Decision "verwerfen".
  - Quelle bleibt liegen (Skill loescht nichts).
  - Sag dem User: "Als nicht-relevant markiert. Wenn du die Datei
    loeschen willst, mach das manuell."

**Wenn `ingest_triage` einen Fehler zurueckgibt** (KnowledgeDB nicht
offen, Pfad ungueltig, etc.): nicht retryen. Skip Triage, weiter mit
Step 2 mit dem User informiert.

## Step 2: Themen-Auswahl + Output-Modus

**Pflicht-Reihenfolge:** Zuerst Themen-Tabelle (Step 2a), dann
Auswahl-Frage (Step 2b), dann Output-Modus (Step 2c). Niemals
Tabelle ueberspringen -- der User entscheidet immer konkret welche
Insights uebernommen werden, egal in welchem Output-Modus.

### Step 2a: Themen destillieren + Tabelle rendern (Chat-Text)

Lies die Source (falls nicht schon im Kontext) und identifiziere die
konkreten Themen / Insights / Take-Aways.

- **Anzahl ergibt sich aus dem Inhalt, nicht aus dem Format.** Eine
  dichte Source kann 15 eigenstaendige Themen tragen, eine duenne 3.
  Eine lange Source mit wenig Substanz auch nur 2-3. Keine Mindest-
  oder Soll-Anzahl -- nimm exakt das, was die Quelle hergibt.
- **Einzeln benannt, nicht in "Buckets" gruppieren** ("Code-bezogenes",
  "Praxis-bezogenes" sind keine Themen, sondern Sammelkategorien).
- **Keine Verduennung.** Wenn die Quelle nur 3 echte Insights hat,
  liste 3 -- erfinde keine zusaetzlichen, damit die Tabelle laenger
  wirkt. Lieber ehrlich knapp.

Tabelle als Chat-Text vor dem Tool-Call rendern, Format strikt:

```markdown
| # | Thema | Kernaussage |
|---|---|---|
| 1 | LLMs als Ghosts | Single-context-Wesen ohne Memory zwischen Sessions. |
| 2 | Jagged Intelligence | Punktuelle Spitzenleistung neben krassem Versagen. |
| 3 | Vibe Coding vs. Agentic Engineering | Gefuehlsgeleitet ohne Verifikation vs. mit Taste + Memory. |
| 4 | Verifiability als Kernkompetenz | Bauen wird billig, validieren wird der Engpass. |
| 5 | Taste und Judgment | Was rein Geschmack war, wird Engineering-Skill. |
| ... |  |  |
```

Kernaussage = 1 knapper Satz, kein Marketing-Sprech.

### Step 2b: Auswahl-Frage (welche Themen)

Direkt nach der Tabelle:

```
ask_followup_question
  question: "Welche Themen aus der Tabelle moechtest du uebernehmen? Klicke 'Alle' oder waehle 'Andere' und tippe die Nummern (z.B. '1,3,5' oder '2-6,9')."
  options: ["Alle"]
```

`allow_multiple` ist nicht gesetzt -- der User klickt "Alle" oder
waehlt "Andere" und tippt Nummern frei. Parsing der Antwort:

- "Alle", "alle", "all" -> alle Themen aus der Tabelle.
- Komma-Liste wie `1,3,5` -> Nummern 1, 3 und 5.
- Range wie `2-6` -> Nummern 2, 3, 4, 5, 6.
- Gemischt wie `1,3-5,9` -> 1, 3, 4, 5, 9.
- Bei Antwort die du nicht parsen kannst: zurueckfragen via
  `ask_followup_question`.

STOPPE nach dem Aufruf, warte auf Antwort.

### Step 2c: Output-Modus fuer die ausgewaehlten Themen

Direkt nach der Themen-Antwort:

```
ask_followup_question
  question: "Wie sollen die ausgewaehlten Themen abgelegt werden?"
  options: [
    "Eine Sense-Making-Note (alle ausgewaehlten Themen gebuendelt)",
    "Mehrere Zettel (ein eigenstaendiger Zettel pro Thema)",
    "Nur Source-Note behalten (Block-IDs setzen, keine derived Notes)",
    "Doch nicht ingesten (spaeter erneut entscheiden)"
  ]
```

STOPPE nach dem Aufruf, warte auf Antwort. Verarbeite:

- **"Eine Sense-Making-Note"** -> Step 3 mit den ausgewaehlten Themen,
  dann Step 4c (Modus A). Frontmatter: `type: - note`.
- **"Mehrere Zettel"** -> Step 3 mit den ausgewaehlten Themen, dann
  Step 4d (Modus B), ein Zettel pro ausgewaehltem Thema. Frontmatter:
  `type: - zettel`.
- **"Nur Source-Note behalten"** -> Step 3 mit den ausgewaehlten Themen
  (damit Block-IDs gesetzt werden). KEIN Step 4 (kein write_file fuer
  Sense-Making/Zettel). Skill endet nach Step 3 mit kurzem Status:
  "Source-Note + Block-IDs gesetzt, keine derived Notes erzeugt".
- **"Doch nicht ingesten (spaeter)"** -> Skill-Abbruch wie bei Step 1
  Decision "Spaeter": Triage-Log auf "spaeter", keine derived Notes,
  Source unangetastet.

Die in Step 2b ausgewaehlten Themen sind ab hier die einzigen, die in
Step 3 und Step 4 verarbeitet werden.

## Step 3: ingest_deep auf der Quelle (source-only)

```
ingest_deep
  source_path="<vault-relativer Pfad zur Quelle>"
  mode="dialog"
  output_mode="source-only"
  cluster="<aus Triage>"
  block_anchors=[
    "<Anker-Text Thema 1, wortwoertlich aus dem Source-Body>",
    "<Anker-Text Thema 2>",
    ...
  ]
```

**`block_anchors` ist Pflicht.** Pro ausgewaehltem Thema aus Step 2a
genau EINE wortwoertliche Phrase aus dem Source-Markdown:

- **Wortwoertlich, nicht semantisch.** Falsch: `"LLMs als Ghosts"` --
  das ist deine Konzept-Beschreibung, kommt im Transkript nicht so vor.
  Richtig: `"I would describe LLMs as just summoned ghosts"` -- exakte
  Phrase aus der Source.
- **5-10 Woerter** -- lang genug fuer Eindeutigkeit, kurz genug damit
  der Tool die Phrase in einer Source-Zeile findet.
- **In Source-Sprache, nicht in Skill-Sprache.** Das Karpathy-Transkript
  ist englisch -> die Anchors sind englisch. Auch wenn die Zettel auf
  Deutsch geschrieben werden.
- **Eine Zeile pro Thema**, in der gleichen Reihenfolge wie die
  Tabelle aus Step 2a.

Vorgehen vor dem Tool-Call:
1. `read_file` der Source-Note (Markdown / PDF-Mirror).
2. Pro Thema die genaue Original-Phrase identifizieren -- bei
   Transkripten typisch der Satz, in dem das Konzept zuerst genannt
   wird.
3. Liste als `block_anchors` zusammenstellen und ans Tool uebergeben.

Der Tool setzt `^block-N`-Suffix an die matchenden Zeilen (idempotent,
fuzzy-tolerant gegen Punctuation/Quote-Varianten) und gibt im Result
die Map `anchor-text -> block-id` zurueck. Diese Map ist die einzige
Quelle der Wahrheit fuer die `[[<Source>#^block-N|↗]]`-Links in Step 4
-- nimm die Block-IDs direkt von dort. Erfinde niemals Block-Ref-Nummern.

**Wenn das Tool-Result eine "WARNUNG: N Anchor(s) wurden nicht gefunden"
zeigt:** Die Anchors haben nicht gematcht. Optionen:
1. `read_file` Source, suche bessere Phrasen, ruf `ingest_deep` erneut
   mit den korrigierten `block_anchors` auf.
2. Wenn auch der zweite Versuch nicht matched: schreibe den Zettel
   ohne `#^block`-Suffix, referenziere nur `[[<Source>]]`. Setze
   NIEMALS einen falschen Block-Ref (z.B. `^block-1` von einem alten
   Run) als Ersatz -- das fuehrt zu Mis-Provenance.

`output_mode` IST IMMER `source-only`. Andere Modi NICHT nutzen.
Sense-Making und Zettel kommen in Step 4 vom Skill selber.

Bei PDFs steht der Markdown-Mirror dann in `<defaultOutputFolder>/`.
Die `block_anchors` referenzieren den Mirror-Text (nicht das PDF-
Original, das ist binary).

**Wenn ingest_deep fehlschlaegt:** nicht retryen, dem User Fehler
zeigen, Skill-Ende.

## Step 4: Sense-Making oder Zettel selber schreiben

Hier macht der Skill die echte Synthese -- NICHT das Tool. Der Agent
schreibt alle Notes nach Step 3 in einem durchgehenden Run, ohne
Mid-Run-Pause. Der User muss NICHT pro Note nochmal genehmigen.

### Step 4a: Naming-Konvention

Sense-Making-Note und Zettel sind **eigenstaendige Konzept-Notes** --
sie haben aussagekraeftige Titel, die das Konzept benennen, NICHT den
Source-Basename als Prefix.

| ❌ Falsch | ✅ Richtig |
|---|---|
| `Andrej Karpathy ... - Zettel 6 - LLMs als Ghosts.md` | `LLMs als Ghosts.md` |
| `Andrej Karpathy ... - Sense-Making.md` | `Karpathy zu Vibe Coding und Agentic Engineering.md` |
| `Andrej Karpathy ... - Zettel 8 - Taste und Judgment.md` | `Taste und Judgment als Coding-Kompetenzen.md` |

Die Verbindung zur Quelle stellt das Frontmatter `resource:
"[[<Source>]]"` plus der Backlink in der Source (Step 5) her.

**Bei Namens-Kollision** (`<Titel>.md` existiert): `read_file` der
existierenden Note. Wenn thematisch passend: ueber
`ask_followup_question` fragen ob ergaenzen oder Variante anlegen
(`<Titel> (<Autor>).md`). Niemals stillschweigend ueberschreiben.

**Stub-Notes (existierende leere/fast-leere Notes mit passendem Titel)
sind nicht anders zu behandeln als jede andere Namens-Kollision** --
sie sind kein "Resume-Trigger", der dich an Step 1-3 vorbeischleusst.
Auch wenn drei Stubs zur Quelle existieren, durchlaufe Step 1 (Triage
+ ask_followup_question), Step 2 (Themen-Auswahl) und Step 3
(ingest_deep) vollstaendig. Erst in Step 4 stellt sich die Frage
"existierender Stub fuellen oder neu nennen", und auch dort via
`ask_followup_question`.

### Step 4b: OKF-Frontmatter komponieren (pro Note)

1. Nimm den **OKF-Frontmatter-Block** verbatim als String.
2. Fuelle die Felder hinter den Doppelpunkten ein.
3. Pflicht-Werte fuer abgeleitete Notes (Sense-Making / Zettel):
   - `title`: Konzept-Titel (= Dateiname ohne `.md`).
   - `description`: 1 Satz Deutsch, max 25 Woerter. Quintessenz des
     Take-Aways. **Nicht identisch mit dem Body** -- Frontmatter ist
     Suchbarkeit, Body ist Ausformulierung.
   - `resource`: `"[[<Source-basename>]]"` (bei Multi-Zettel: alle
     Zettel referenzieren die Source direkt, NICHT eine separate
     Bibliographie -- die existiert nicht mehr).
   - `tags`: 3-5 lowercase, bindestrich-verbunden.
   - `type`: YAML-Liste.
     - Sense-Making (Modus A) -> erster Wert `- note`
     - Multi-Zettel (Modus B) -> erster Wert `- zettel`
     - Zweiter Wert optional (inhaltlicher Subtyp).
   - `moc`: 2-5 Wikilinks aus Triage-Karte + Konzept-Hubs.
   - `related`: Wikilinks zu konkreten anderen Notes -- Autor(en) der
     Source als Person-Wikilinks, andere thematisch verbundene Notes
     (kann sonst leer bleiben).
   - `timestamp`: Erstellungsdatum der Note (ISO 8601).
   - `uid`: leer.
4. **Niemals YAML-Parser nutzen.** Block ist String.
5. **Niemals doppelte `---`.** Wenn der OKF-Block schon `---\n...\n---\n`
   enthaelt, ist das DER Frontmatter-Block, ueberkleb ihn nicht.

### Step 4c (Modus A: Sense-Making-Note -- EIN write_file)

```
write_file
  path = "<defaultOutputFolder>/<aussagekraeftiger Titel>.md"
  content = """
<OKF-FRONTMATTER VERBATIM, Werte gefuellt, type: - note>

# <aussagekraeftiger Titel>

## Kernaussage

<1-3 Saetze, pointiert.>

## Take-Aways

- <Take-Away 1, ausformuliert.> [[<Source>#^block-N|↗]]
- <Take-Away 2.> [[<Source>#^block-M|↗]]
- ...

## Eigene Notizen

<Optional.>
"""
```

Block-IDs kommen aus dem `ingest_deep`-Result von Step 3 (Map
`anchor-text -> block-id`). Erfinde keine Nummern. Bei PDF-Page-Refs:
`[[<Source>.pdf#page=N|↗]]`.

**Source-Mirror-Frontmatter erweitern**: nach dem write_file ergaenze
das `description`-Feld der Source-Note (falls noch leer) und ggf.
`moc:` via `update_frontmatter`. Das `related:`-Feld wird in Step 5
gesetzt.

### Step 4d (Modus B: Multi-Zettel -- N write_file im Auto-Loop)

**KEINE Bibliographie-Note schreiben.** Die Source-Note (bzw. der
PDF-Markdown-Mirror) IST die Bibliographie -- sie hat schon OKF-
Frontmatter mit `type: - source` und die Block-IDs aus Step 3.
Erstelle nur die N Zettel.

**Auto-Loop:** Schreibe ALLE N Zettel in einem Run, ohne Mid-Run-
Pause, ohne User-Approval zwischen den write_file-Calls. Erst nach
dem letzten Zettel weiter mit Step 4e.

Pro Take-Away EIN `write_file`:

```
write_file
  path = "<defaultOutputFolder>/<Konzept-Titel>.md"
  content = """
<OKF-FRONTMATTER VERBATIM, Werte gefuellt -- type: - zettel, resource: "[[<Source-basename>]]">

# <Konzept-Titel>

<Ein klar formulierter Gedanke in 1-3 Absaetzen. Eigene Worte, nicht
Source-Wortlaut. Was ist die Insight, warum ist sie relevant?>

## Quelle

[[<Source>]] -- siehe [[<Source>#^block-N|↗]]
"""
```

Die Block-ID N kommt direkt aus der Map des `ingest_deep`-Result von
Step 3 (jeweiliges Thema -> Block-ID).

**Source-Body erweitern** (nach allen Zetteln, EIN `write_file`-Edit
auf die Source-Note): ergaenze am Ende des Bodys eine
`## Abgeleitete Zettel`-Section mit einem Base-Codeblock, der die
Zettel dynamisch auflistet:

```markdown
## Abgeleitete Zettel

\`\`\`base
from ""
where resource = link(this.file)
sort created asc
\`\`\`
```

Damit ersetzt die Source-Note die fruehere Bibliographie -- ein
Knoten weniger, gleicher Effekt.

### Step 4e: Verifizieren (am Run-Ende)

- Falls `write_file`-Fehler "File already exists" -> Step 4a
  (Namens-Kollision) anwenden.
- Bei YAML-Errors in Obsidian-Console (`Can not update metadata...`):
  die Note hat doppelte `---` oder kaputtes Frontmatter. `read_file`,
  Frontmatter-Block sauber rekomponieren (OKF-Template verbatim +
  Werte), via `write_file` ueberschreiben.

## Step 5: Backlink in der Quelle (PFLICHT, nicht skippen)

Diese Schritt-Sequenz ist obligatorisch. Der Skill ist nicht
abgeschlossen, solange die Quelle nicht zurueck auf ALLE neu
erstellten Notes verlinkt -- das ist Kern des bidirektionalen
Zettelkasten-Grafen.

**Sammle waehrend Step 4** die Pfade ALLER neu erstellten Notes in
einer Liste `createdNotes` (egal ob Sense-Making oder N Zettel).

**Reihenfolge in Step 5 ist strikt:**

1. **Source-Frontmatter lesen:**
   ```
   get_frontmatter path="<Source-Pfad>"
   ```
2. **Verifikation:** Pruefe, dass das Frontmatter als ersten
   `type`-Eintrag `source` traegt. Wenn nicht: STOP und frag via
   `ask_followup_question`.
3. **`related:`-Liste komponieren:** Bestehende `related:`-Eintraege
   aus dem `get_frontmatter`-Result + alle Pfade aus `createdNotes`
   (als `"[[basename]]"`-Wikilinks). Duplikate entfernen.
4. **Frontmatter schreiben (REPLACE -- das Tool kennt kein append):**
   ```
   update_frontmatter
     path="<Source-Pfad>"
     updates={
       "related": ["[[note-1]]", "[[note-2]]", ...,
                   "[[neu-zettel-1]]", ..., "[[neu-zettel-N]]"]
     }
   ```
   **Wichtig:** das `update_frontmatter`-Tool macht REPLACE auf den
   Wert -- d.h. du musst die VOLLSTAENDIGE Liste (alt + neu) im
   `updates`-Objekt mitgeben. Wenn du nur die neuen reinschreibst,
   verlierst du die alten. Das war der haeufigste Fehlerfall.

**Modi:**
- **Modus A (Sense-Making):** `createdNotes` = die EINE Sense-Making-Note.
- **Modus B (Multi-Zettel):** `createdNotes` = ALLE N Zettel. Es gibt
  keine Bibliographie mehr -- die Source IST die Bibliographie.

Damit zeigt der Obsidian-Graph die Verbindung Quelle <-> alle
abgeleiteten Konzept-Notes ueber `related` (Source -> abgeleitete) und
`resource` (abgeleitete -> Source) bidirektional.

## Output-Konvention (verbindlich)

Pro Aussage in der Sense-Making-Note (oder pro Zettel in Multi-Modus)
muss am Satzende ein dezenter Block-Ref-Link stehen:

```markdown
Letzter Satz der Aussage. [[source-mirror#^block-N|↗]]
```

Pflicht-Form:

- Display-Text immer **nur** `↗`. Kein "Quelle:", kein "[1]".
- Inline am Satzende, ein Leerzeichen vor dem Link.
- Eine Block-Ref pro Kernaussage.

## Verbote

- Keine `[1]`-Marker im Perplexity-Stil.
- Keine `pdfStrategy: 'page-refs'` in `/ingest-deep` (das ist /ingest-Default).
- Keine Halluzinationen: jede Aussage muss aus der Source belegt sein.
- **Keine Retry-Loops.** Bei Tool-Fehler: STOP, User informieren.
- **Kein `read_document` als Erkundungs-Pre-Pass.** Source-Text liegt
  bereits als `<attached_document>` oder Vault-File vor.
- **Kein `list_files` zur Pfad-Suche.** User fragen ist billiger.
- Bestehende User-Edits in MOC-Files nicht ueberschreiben.
- **Kein `ingest_deep` mit `output_mode != source-only`.** Das Tool
  generiert dort naive Transkript-Splitter mit `<Source> - Zettel N`-
  Titeln. Sense-Making und Zettel kommen aus Step 4 vom Skill selber.
- **Kein Source-Prefix in Zettel-/Sense-Making-Titeln.** Die Notes
  sind eigenstaendige Konzept-Notes, ihre Titel benennen das Konzept.
- **Kein YAML-Re-Render des OKF-Templates.** Der Frontmatter-Block
  ist ein verbatim String, in den Werte hinter den Doppelpunkten
  eingesetzt werden. Niemals zerlegen und neu zusammensetzen -- das
  bricht das Frontmatter (Doppel-`---`, verlorene Custom-Felder).
- **Keine alten Templates lesen.** `Quelle Template.md`,
  `Zettel Template.md`, `Notiz Template.md` sind abgeloest. Nur
  `OKF Template.md` ist Master.
- **Keine Tool-internen Legacy-Properties stehenlassen.** Wenn der
  PDF-Markdown-Mirror auf einer alten Plugin-Version erzeugt wurde,
  kann das Frontmatter noch die Felder `source_pdf:`,
  `mirror_generated_at:` und `bar25_pdf_strategy:` enthalten. Diese
  drei Felder sind nicht Teil des OKF-Schemas und muessen via
  `update_frontmatter` mit `null`-Wert (oder per explizitem Remove)
  entfernt werden, bevor der Skill `attempt_completion` ruft. Die
  aktuelle Plugin-Version emittiert sie nicht mehr, aber bestehende
  Mirror-Notes muessen bereinigt werden.
- **Keine neuen Frontmatter-Properties erfinden.** Das OKF-Schema
  hat genau diese Felder: `title`, `description`, `resource`, `tags`,
  `type`, `moc`, `related`, `timestamp`, `uid`. Keine zusaetzlichen
  Properties wie `cluster`, `source_type`, `ingested_at`,
  `bar25_pdf_strategy`, `mirror_generated_at`, `source_pdf` etc.
  Wenn solche Werte gespeichert werden muessen, gehoeren sie in
  `moc` (Cluster), `type` (Source-Subtyp), `timestamp`
  (Veroeffentlichungsdatum) oder den Body.
- **Keine alten Properties verwenden.** Mapping ist abschliessend:
  - `Zusammenfassung` -> `description` (1 Satz, max 25 Woerter)
  - `Autor` -> `related` als Person-Wikilink (`"[[Vorname Nachname]]"`)
  - `Jahr` -> `timestamp` (Veroeffentlichungsdatum als Datetime,
    ISO 8601)
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
- **Keine Transkript-Schnipsel als Zettel-Body.** Ein Zettel formuliert
  EINEN Gedanken in eigenen Worten in 1-3 Absaetzen. Roher Source-Text
  gehoert nicht in den Body -- referenziere stattdessen via Block-Ref.
- **Keine separate Bibliographie-Note bei Multi-Zettel.** Die Source-Note
  (bzw. der PDF-Markdown-Mirror) IST die Bibliographie. Source-Frontmatter
  wird via `update_frontmatter` erweitert; der `## Abgeleitete Zettel`-
  Block kommt in den Body, nicht ins Frontmatter. Eine separate
  `<Source> (Bibliografie).md`-Note ist Redundanz und wird nicht erzeugt.
- **Kein Mid-Run-Pause beim Schreiben der Zettel.** Wenn der User in
  Step 2a 12 Themen ausgewaehlt hat, schreibt Step 4d ALLE 12 Zettel
  in einem Run. Niemals nach 5 Zetteln stoppen und nachfragen. Der
  User hat in Step 2 entschieden.
- **Keine erfundenen Block-IDs.** Nutze nur die `^block-N`-Werte aus
  dem `ingest_deep`-Result von Step 3 (Map `anchor-text -> block-id`).
  Wenn fuer ein Thema kein Block-ID generiert wurde (Anchor matchte
  nicht), referenziere die Source nur via `[[<Source>]]` ohne `#^block`.
- **Vorbereitung NICHT in update_todo_list aufnehmen.** Das ist
  Skill-interne Vorbereitung (OKF Template lesen, Naming-Convention,
  app.json). Der User sieht nur Steps 1-5 im Plan.
- **Skill nicht abschliessen ohne Step 5.** Solange das Source-
  Frontmatter `related:` nicht auf ALLE neu erstellten Notes zeigt,
  fehlt die bidirektionale Verbindung -- der Zettelkasten ist
  inkonsistent. Vor `attempt_completion`: pruefe via `get_frontmatter`,
  dass jeder Pfad aus `createdNotes` in `related:` steht.
- **Skill nicht abschliessen ohne Binary-Ablage.** Wenn die Quelle ein
  PDF/DOCX/XLSX war (Chat-Attachment oder vorher schon im Vault),
  muss das Original am Ende in
  `<attachmentFolderPath>/<Autor>-<Jahr>_<Titel>.<ext>` liegen, mit
  korrektem Naming. Vor `attempt_completion`: pruefe ob das Binary
  dort existiert. Wenn nicht: `move_file` von der aktuellen Position
  (Chat-Attachments werden automatisch im Vault gespeichert -- du
  musst sie nie via Drag-and-Drop anfordern, nur ggf. umbenennen).
- **Skill nicht abschliessen ohne type-Check.** Vor
  `attempt_completion`: pruefe via `get_frontmatter` fuer JEDE
  neu erstellte Note, dass der ERSTE `type`-Eintrag korrekt ist:
  - Source-Mirror -> `- source` (zweiter Eintrag idealerweise
    inhaltlicher Subtyp wie `- Analyst Report`)
  - Sense-Making-Note (Modus A) -> `- note`
  - Multi-Zettel (Modus B) -> `- zettel`
  - MOC-Stub -> `- moc`
  Wenn nicht: via `update_frontmatter` korrigieren, dann nochmal pruefen.
- **`update_frontmatter` ist REPLACE, nicht APPEND.** Bei `related:`
  IMMER vorher via `get_frontmatter` lesen, alte + neue Eintraege
  zusammen ins `updates`-Objekt schreiben. Sonst gehen die
  bestehenden Eintraege verloren.
- **Keine un-gequoteten Wikilinks im Frontmatter.** `resource: [[Note]]`
  ohne Quotes ist invalid YAML. Immer `resource: "[[Note]]"` oder als
  gequotete Liste.
- **Keine un-gequoteten String-Werte im Frontmatter.** `description:
  Gartner-Analyse...`, `title: Gibson-2026_...`, `resource: https://...`
  -- alles falsch ohne Quotes. Strings sind ALLES, was kein
  YAML-Listen-Eintrag, kein Boolean (`true`/`false`) und keine
  Zahl ist. Auch bei Step 0 (`ingest_document` mit `header_content`)
  gilt das.
- **Keine Komma-Strings fuer Listen-Felder.** `moc: A, B, C` ist
  EIN String. YAML-Liste mit `-` Bindestrichen schreiben, sonst
  greifen Obsidian-Tag-/Property-Filter nicht. Das gilt fuer JEDES
  Wikilink-Property (`moc`, `related`, `type`). Block-Form
  (`moc:\n  - "[[X]]"`) oder Flow-Form (`moc: ["[[X]]"]`) sind
  beide ok. Auch bei einem einzigen Wert bleibt es eine ein-elementige
  Liste, damit spaetere Ergaenzungen den Type nicht wechseln muessen.
- **Uppercase-Tags sind ein Bug.** `tags: AI-Agent` falsch.
  Lowercase, bindestrich-verbunden: `tags: ai-agent`. Gilt fuer jede
  Note.
- **`type`-Liste hat 1-2 Eintraege, nicht mehr.** Erster Wert ist die
  Note-Kategorie (`- source` | `- note` | `- zettel` | `- moc` |
  `- person` | `- project` | `- meeting`), zweiter Wert ist der
  optionale inhaltliche Subtyp (`- Analyst Report`, `- Interview`,
  etc.). Keine drei Eintraege, kein leeres `type:`.
- **`type` ist NIE leer oder generisch bei Ingest-Notes.** Aus Sources
  abgeleitete Notes (Sense-Making, Zettel) tragen IMMER `- note` oder
  `- zettel` als ersten Wert. Source-Mirror traegt IMMER `- source`
  als ersten Wert. Das ist nicht verhandelbar.
- **Keine Triage-Karte ohne Empfehlung.** Step 1 muss IMMER mit einer
  expliziten Empfehlung (Ingest / Spaeter / Verwerfen) plus
  Begruendung enden -- nicht nur die Karte zeigen und User entscheiden
  lassen ohne Hinweis.
- **Kein Skip von Step 1's Decision-Frage.** Auch wenn die Empfehlung
  "Ingest" lautet und Step 1 wenige Sekunden dauern wuerde: die
  `ask_followup_question` ist Pflicht. Niemals direkt von Triage zu
  Step 2 durchlaufen, auch nicht "weil der User ja /ingest-deep
  aufgerufen hat". Der Skill-Aufruf startet den Workflow, die Decision
  -Frage entscheidet ob er ueberhaupt durchlaeuft.
- **Keine Sprachmischung.** Skill-Sprache folgt der Source/User-Sprache.
  Niemals "I'll start by..." in einem deutschen Run.
- **Keine em-dashes (—) oder en-dashes (–)** in Chat-Antworten oder
  erzeugten Notes. Punkt, Komma, Klammer, "und"/"aber" stattdessen.
- **Keine semantischen `block_anchors`.** Anchors sind wortwoertliche
  Source-Phrasen (5-10 Woerter), nicht Konzept-Beschreibungen. Bei
  Mismatch: lieber kein Block-Ref als ein falscher.
- **Keine `moc`/`related`-Eintraege als reine Strings -- nicht in der
  Source-Mirror-Note, nicht in Zettel.** Immer als gequotete Wikilinks
  in YAML-Liste, sonst keine Graph-Kante. Die Frontmatter-Hygiene
  gilt auch fuer `ingest_document`'s `header_content`.
- **Source-Mirror nie in `related:` der abgeleiteten Notes.** Bei
  Sense-Making (Modus A) und Multi-Zettel (Modus B) gehoert die
  Source-Mirror-Note ausschliesslich in `resource:`. Ein zusaetzlicher
  `[[<Source-Mirror>]]`-Wikilink im `related:`-Feld ist Redundanz und
  verboten. Triage-Karten-Eintraege, die auf die aktuelle Source
  zeigen, beim Sortieren rausfiltern.
- **Keine Wikilinks zu Binaries im `resource:`-Feld.** PDF/DOCX/PPTX/
  XLSX werden als Markdown-Link `[Label](<vault-pfad>)` referenziert,
  niemals als `[[file.pdf]]`-Wikilink. Wikilinks zu .md-Files (zur
  Mirror-Note) sind hingegen Pflicht-Form fuer `resource:` bei
  Sense-Making/Zettel-Notes.
- **Keine moc-Auslassung aus der Triage.** Wenn die Triage-Karte
  `Cluster-Match` und `Verwandte Notes (Vault)` aufgelistet hat,
  MUESSEN diese Wikilinks im `moc:`-Feld der erzeugten Notes
  erscheinen. Der Skill ist unvollstaendig wenn die Triage z.B. 5
  verwandte Notes gefunden hat und im `moc` nur 1 davon steht.
- **Kein open_note + execute_command fuer UID-Setzung.** Das UID-
  Plugin (wenn vorhanden) macht's eigenstaendig via Auto-Generation
  beim Note-Create. Skill-eigene UID-Tool-Calls triggern unnoetige
  Editor-View-Wechsel und Re-Renders bei Frontmatter-Plugins (z.B.
  pretty-properties) und sind nicht erlaubt.
- **Keine hardcoded Ablage-Pfade.** `Attachements` und `Inbox` sind
  Sebastians aktuelle Default-Werte, koennen aber per Obsidian-Setting
  jederzeit anders sein. Lies `.obsidian/app.json` und benutze die
  Felder `attachmentFolderPath` und `newFileFolderPath`.
- **Keine PDFs in `<newFileFolderPath>` liegenlassen.** Binaries
  gehoeren nach `<attachmentFolderPath>`, mit Naming-Convention. Wenn
  eine PDF dort hineingerutscht ist (z.B. Inbox/foo.pdf), via
  `move_file` umziehen vor dem Ingest.
- **Keine `.md`-Datei nach `<attachmentFolderPath>` verschieben.**
  Auch nicht "weil die PDF gerade nicht da ist". Wenn die PDF fehlt:
  `ask_followup_question` an den User, nicht einen anderen File
  umbenennen. Attachements/ enthaelt NUR Binaries (.pdf, .docx,
  .xlsx, .pptx). Inbox/ enthaelt NUR Markdown-Notes.
- **Kein altes Naming-Schema `Autor-Jahr-Titel` (drei Bindestriche).**
  Korrekt ist `Autor-Jahr_Titel` mit Unterstrich zwischen Jahr und
  Titel -- so wie in `Tools & Settings/Templates/Dateinamens-Konventionen.md`
  dokumentiert.
- **Keine neuen Ordner erstellen.** Erlaubt sind ausschliesslich:
  `Attachements/` (fuer Original-Binaries: PDF/DOCX/PPTX/XLSX), und
  `<defaultOutputFolder>/` (Default `Inbox/`, fuer alle Markdown-Notes
  inkl. Mirror, Sense-Making, Zettel). Kein `Sources/`, kein
  `Knowledge/<cluster>/`. Wenn der defaultOutputFolder fehlt,
  legt das Plugin ihn beim ersten Schreibvorgang an -- der Skill darf
  ihn nicht selber via `create_folder` anlegen.
- **Keine Source-Duplikate.** Wenn die Quelle bereits als Markdown-Note
  im Vault liegt, wird sie NICHT in `<defaultOutputFolder>/` kopiert.
  `ingest_deep` setzt Block-IDs direkt in die Original-Note ein
  (Frontmatter bleibt erhalten). Ausnahme: PDFs/Office-Files bekommen
  einen Markdown-Mirror, weil der Originalcontent binaer ist.
- **Kein Stale-Mirror-Workaround (BUG-029, Issue #312):** Wenn die
  konkrete Source nicht lesbar ist (Attachment ist weg, Vault-Pfad nicht
  gefunden, Parser-Fehler), NICHT auf eine gleichnamige Vault-Datei
  ausweichen (`Sources/<basename>-Mirror.md`, `Notes/<basename>.md`,
  etc.). Eine alte Mirror-Datei ist NICHT die aktuelle Source --
  Inhalte koennen veraltet, gekuerzt oder editiert sein. STOP, dem
  User die genaue Tool-Fehlermeldung zeigen, klaeren wo die Datei
  liegen soll. Auch nicht den Inhalt aus dem `<attached_document>`-
  Block im eigenen Kontext "rekonstruieren" und so tun, als sei das
  ein verifizierter Read -- entweder das Originaltext-Block explizit
  als Quelle nennen ODER die Datei in den Vault speichern und neu
  triagen.

## Notfall-Pfad: write_file

Wenn `ingest_document` und `ingest_deep` beide fehlschlagen (z.B.
Attachment weg, KnowledgeDB nicht initialisiert, Provider-Quota voll):

1. Extrahiere die Page-Struktur aus dem `<attached_document>`-Block in
   deinem Kontext (sucht nach `## Page N`-Headings).
2. Schreibe via `write_file` eine Single-Note mit:
   - OKF-Frontmatter (title, description, resource, tags, type:
     `- source`, moc, related, timestamp, uid)
   - `## Overview`
   - `## Kernaussagen` mit pro Aussage `[[<basename>#Page <N>|↗]]`-Marker
     -- Page-Number aus dem geparsten Text ableiten
   - `## Originaltext` mit dem vollstaendigen geparsten Text
3. Tu das in EINEM `write_file`-Call. Kein Edit-Loop.
