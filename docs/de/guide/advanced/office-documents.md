---
title: Office-Dokumente
description: Erstelle PPTX-, DOCX- und XLSX-Präsentationen und -Dokumente aus deinen Notizen.
---

# Office-Dokumente

Obsilo kann PowerPoint-Präsentationen, Word-Dokumente und Excel-Tabellen direkt in deinem Vault erstellen. Außerdem kann es bestehende Office-Dateien lesen und deren Inhalt als Kontext in Konversationen nutzen.

## Was du erstellen kannst

| Format | Tool | Was es erzeugt |
|--------|------|---------------|
| **PPTX** | `create_pptx` | PowerPoint-Präsentationen mit Folien, Text, Bildern und Layouts |
| **DOCX** | `create_docx` | Word-Dokumente mit Überschriften, Absätzen, Listen, Tabellen und Bildern |
| **XLSX** | `create_xlsx` | Excel-Tabellen mit mehreren Blättern, Formatierung und Formeln |

## Einfach erstellen -- einfach fragen

Der einfachste Weg, ein Dokument zu erstellen, ist eine Beschreibung dessen, was du brauchst:

- *"Erstelle eine Präsentation über unsere Q1-Ergebnisse basierend auf meinen Notizen in Reports/"*
- *"Wandle diese Notiz in ein Word-Dokument mit sauberen Überschriften und Inhaltsverzeichnis um"*
- *"Erstelle eine Tabelle zur Verfolgung meiner Leseliste mit Spalten für Titel, Autor, Status und Bewertung"*

Der Agent liest die relevanten Notizen, strukturiert den Inhalt und erzeugt die Datei in deinem Vault.

:::tip Einfach anfangen
Du musst keine exakten Folienlayouts oder Zellenformatierungen angeben. Der Agent trifft sinnvolle Entscheidungen. Du kannst jederzeit verfeinern, z.B. "mach die Titelfolie auffälliger" oder "füge ein Diagramm für die Monatsdaten hinzu."
:::

## Template-Workflow für Präsentationen

Für professionelle oder unternehmensinterne Präsentationen unterstützt Obsilo eine vorlagenbasierte Pipeline. Das ist der leistungsfähigste Weg, Präsentationen zu erstellen, die zum Design deiner Organisation passen.

### So funktioniert es

1. **Vorlage bereitstellen** -- Lege eine `.pptx`-Template-Datei in deinem Vault ab
2. **Agent analysiert sie** -- Der Agent scannt jedes Folienlayout, jeden Platzhalter und jede Form im Template (gespeichert als TemplateCatalog)
3. **Agent plant den Inhalt** -- Ein interner LLM-Aufruf ordnet dein Quellmaterial der Struktur des Templates zu und plant den Inhalt für jede Folie und Form
4. **Agent generiert** -- Die fertige Präsentation wird mit dem exakten Design deines Templates erstellt

### Schritt für Schritt

1. Hänge dein Template an oder erwähne es: *"Nutze @firmen-template.pptx, um eine Präsentation über unsere Produkt-Roadmap zu erstellen"*
2. Der Agent führt intern `plan_presentation` aus -- du siehst es im Activity-Block
3. Er erstellt die fertige `.pptx`-Datei mit deinem Inhalt im Design deines Templates

### Der 6-Schritte Office-Workflow

Für beste Ergebnisse folgt Obsilo einem eingebauten Workflow:

1. **Context** -- Quellmaterial aus deinem Vault sammeln
2. **Template** -- Die bereitgestellte Vorlage analysieren (oder Ad-hoc-Modus verwenden)
3. **Plan** -- Inhalt auf Folien und Formen abbilden
4. **Generate** -- Das Dokument erstellen
5. **Verify** -- Auf fehlende Platzhalter oder Layout-Probleme prüfen
6. **Deliver** -- In deinem Vault speichern und bestätigen

:::info Zwei Modi
Der **Ad-hoc-Modus** erstellt Präsentationen von Grund auf ohne Template (mit PptxGenJS). Der **Template-Modus** verwendet deine Firmen-`.pptx`-Datei für konsistentes Branding. Der Agent wählt den richtigen Modus je nachdem, ob du ein Template bereitstellst.
:::

## Office-Dokumente lesen

Obsilo kann bestehende Office-Dateien parsen und deren Inhalt in Konversationen verwenden. Das funktioniert für:

- **PPTX** -- Extrahiert Text aus allen Folien
- **DOCX** -- Extrahiert Überschriften, Absätze, Tabellen
- **XLSX** -- Extrahiert Blattdaten und Formeln
- **PDF** -- Extrahiert Textinhalt
- **CSV** -- Liest strukturierte Daten

**So geht's:**
- Ziehe eine Office-Datei per Drag-and-Drop in den Chat
- Verwende `@dateiname.pptx`, um sie zu erwähnen
- Frage: *"Fasse die angehängte Tabelle zusammen"* oder *"Was sind die wichtigsten Punkte dieser Präsentation?"*

Der Agent nutzt das `read_document`-Tool zum Parsen der Datei und arbeitet dann mit dem extrahierten Inhalt wie mit jeder anderen Notiz.

## Visuelle Qualitätskontrolle mit LibreOffice

Wenn LibreOffice auf deinem System installiert ist, kann Obsilo deine generierten Präsentationen als Bilder rendern -- zur visuellen Qualitätsprüfung.

Das `render_presentation`-Tool konvertiert jede Folie in ein Bild, sodass der Agent Layouts, Textüberläufe und visuelle Konsistenz prüfen kann -- bevor du die Datei selbst öffnest.

:::warning LibreOffice erforderlich
Die visuelle Qualitätskontrolle funktioniert nur, wenn LibreOffice installiert und über die Kommandozeile erreichbar ist. Ohne LibreOffice überspringt der Agent die visuelle Prüfung und verlässt sich ausschließlich auf strukturelle Validierung.
:::

## Tipps für bessere Dokumente

1. **Quellmaterial bereitstellen.** Je mehr Kontext du gibst (Notizen, Daten, Gliederungen), desto besser das Ergebnis.
2. **Struktur vorgeben.** "5 Folien mit Intro, 3 Inhaltsfolien und Zusammenfassung" liefert bessere Ergebnisse als "mach eine Präsentation."
3. **Templates für Konsistenz nutzen.** Wenn du regelmäßig Präsentationen erstellst, investiere in ein gutes Template -- der Agent nutzt es jedes Mal perfekt wieder.
4. **Iterativ arbeiten.** Bitte den Agent nach der ersten Version, bestimmte Folien oder Abschnitte anzupassen, statt alles neu zu generieren.
5. **Activity-Block prüfen.** Dort siehst du den Plan, den der Agent erstellt hat, und kannst seine Entscheidungen nachvollziehen.

## Nächste Schritte

- [Skills, Regeln & Workflows](/de/guide/advanced/skills-rules-workflows) -- Automatisiere deinen Dokumenterstellungsprozess
- [Connectors](/de/guide/advanced/connectors) -- Verbinde externe Tools und Datenquellen
- [Multi-Agent & Tasks](/de/guide/advanced/multi-agent) -- Delegiere komplexe Dokumentaufgaben an Sub-Agents
