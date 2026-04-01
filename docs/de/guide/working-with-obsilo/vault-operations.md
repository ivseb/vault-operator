---
title: Vault-Operationen
description: Wie Obsilo deinen Vault liest, beschreibt, durchsucht und strukturiert.
---

# Vault-Operationen

Obsilo kann Dateien in deinem gesamten Vault lesen, schreiben, durchsuchen und organisieren. Diese Seite erklaert, was der Agent kann, wie jede Operation funktioniert und wann du sie einsetzen wuerdest.

## Wie es funktioniert

Der Agent greift nicht direkt auf deinen Vault zu. Er verwendet **Tools** -- kleine, spezialisierte Funktionen, die jeweils eine bestimmte Aufgabe erledigen. Wenn du den Agent bittest, eine Notiz zu finden oder eine Datei zu erstellen, waehlt er die passenden Tools aus und ruft sie in deinem Auftrag auf.

Jeder Tool Call ist im [Activity Block](/de/guide/working-with-obsilo/chat-interface#activity-blocks) sichtbar, und Schreiboperationen erfordern eine [Genehmigung](/de/guide/working-with-obsilo/safety-control), sofern du Auto-Approve nicht aktiviert hast.

## Deinen Vault lesen

Diese Tools lassen den Agent deine Dateien ansehen, ohne etwas zu veraendern. Sie sind sowohl im **Ask**- als auch im **Agent**-Mode verfuegbar.

| Tool | Was es tut |
|------|-----------|
| **read_file** | Oeffnet eine Notiz und liest ihren Inhalt |
| **list_files** | Listet Dateien und Ordner in einem bestimmten Pfad auf |
| **search_files** | Findet Notizen anhand von Textinhalten (Keyword-Suche) |
| **search_by_tag** | Findet alle Notizen mit einem bestimmten Tag |
| **get_frontmatter** | Liest die YAML-Metadaten am Anfang einer Notiz |
| **get_linked_notes** | Folgt Wikilinks und Backlinks ausgehend von einer Notiz |
| **get_daily_note** | Oeffnet die heutige Daily Note (oder ein bestimmtes Datum) |

### Praktische Beispiele

- *"Welche Notizen habe ich im Projects-Ordner?"* -- nutzt `list_files`
- *"Finde alles, was ich ueber Client-Onboarding geschrieben habe"* -- nutzt `search_files`
- *"Zeig mir alle Notizen mit dem Tag #review"* -- nutzt `search_by_tag`
- *"Was verlinkt auf meine Quartalszeile-Notiz?"* -- nutzt `get_linked_notes`
- *"Lies die heutige Daily Note"* -- nutzt `get_daily_note`

:::tip Semantische Suche geht weiter
Keyword-Suche findet exakte Woerter. Um Notizen nach Bedeutung zu finden (z.B. "Notizen ueber besseren Schlaf" findet eine Notiz mit dem Titel "Abendroutine"), siehe [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery).
:::

## Schreiben und Bearbeiten

Diese Tools veraendern deinen Vault. Sie sind nur im **Agent**-Mode verfuegbar und erfordern standardmaessig eine Genehmigung.

| Tool | Was es tut |
|------|-----------|
| **write_file** | Erstellt eine neue Notiz oder ersetzt eine bestehende |
| **edit_file** | Nimmt gezielte Aenderungen an einem Teil einer Notiz vor |
| **append_to_file** | Fuegt Inhalt am Ende einer bestehenden Notiz hinzu |
| **update_frontmatter** | Aendert YAML-Metadatenfelder |

### Praktische Beispiele

- *"Erstelle eine Notiz, die unsere Q1-Ergebnisse zusammenfasst"* -- nutzt `write_file`
- *"Ersetze den zweiten Absatz in @project-brief durch eine kuerzere Version"* -- nutzt `edit_file`
- *"Fuege die heutigen Action Items zu @task-list hinzu"* -- nutzt `append_to_file`
- *"Setze das Status-Feld in @project-brief auf 'complete'"* -- nutzt `update_frontmatter`

:::info Checkpoints schuetzen deine Dateien
Vor jeder Schreiboperation speichert Obsilo einen Snapshot der Datei. Falls etwas schiefgeht, klicke auf **Undo** in der [Undo-Leiste](/de/guide/working-with-obsilo/chat-interface#die-undo-leiste), um das Original wiederherzustellen.
:::

## Dateien und Ordner organisieren

Diese Tools helfen dir, deinen Vault umzustrukturieren.

| Tool | Was es tut |
|------|-----------|
| **create_folder** | Erstellt einen neuen Ordner (einschliesslich verschachtelter Pfade) |
| **move_file** | Verschiebt eine Notiz in einen anderen Ordner oder benennt sie um |
| **delete_file** | Verschiebt eine Notiz in den Obsidian-Papierkorb |

### Praktische Beispiele

- *"Erstelle einen Archive/2025-Ordner und verschiebe alle Notizen mit dem Tag #archived dorthin"* -- nutzt `create_folder` + `move_file`
- *"Benenne @old-project-name in new-project-name um"* -- nutzt `move_file`
- *"Loesche alle leeren Notizen im Inbox-Ordner"* -- nutzt `delete_file`

:::warning Loeschen nutzt den Obsidian-Papierkorb
Geloeschte Dateien landen im Obsidian-Papierkorb (`.trash`-Ordner), nicht in der dauerhaften Loeschung. Du kannst sie von dort wiederherstellen. Dies folgt dem Standard-Dateiverwaltungsverhalten von Obsidian.
:::

## Vault-Statistiken

Der Agent kann dir mit **get_vault_stats** einen Ueberblick ueber deinen Vault geben:

- Gesamtzahl der Notizen, Ordner und Anhaenge
- Vault-Groesse
- Tag-Verteilung
- Zuletzt geaenderte Dateien

**Beispiel:** *"Gib mir eine Zusammenfassung meines Vaults -- wie viele Notizen, was sind die meistgenutzten Tags?"*

## Canvas und visuelle Karten

Obsilo kann visuelle Darstellungen deiner Notizen und ihrer Beziehungen erstellen.

| Tool | Was es tut |
|------|-----------|
| **generate_canvas** | Erstellt ein Obsidian Canvas (.canvas) mit Karten und Verbindungen |
| **create_excalidraw** | Erstellt eine Excalidraw-Zeichnung (erfordert das Excalidraw-Plugin) |

**Beispiel:** *"Erstelle eine Canvas-Karte, die alle Notizen im Projects-Ordner und ihre Verbindungen zeigt"*

## Bases (strukturierte Daten)

Mit Bases kannst du deine Notizen als strukturierte Daten nutzen -- aehnlich einer Datenbankansicht.

| Tool | Was es tut |
|------|-----------|
| **create_base** | Erstellt eine neue Base aus Notizen, die bestimmte Kriterien erfuellen |
| **query_base** | Fragt eine bestehende Base mit Filtern und Sortierung ab |
| **update_base** | Aendert Eintraege in einer Base |

**Beispiel:** *"Erstelle eine Base aller Notizen mit dem Tag #book mit Spalten fuer Autor, Bewertung und Status aus dem Frontmatter"*

:::info Erfordert Obsidian Bases
Die Bases-Funktion nutzt Obsidians integrierte Bases-Funktionalitaet. Stelle sicher, dass deine Obsidian-Version diese unterstuetzt (1.8+).
:::

## Tipps fuer Vault-Operationen

1. **Sei spezifisch bei Pfaden.** "Der Projects-Ordner" ist klarer als "meine Projektnotizen".
2. **Nutze @-Erwaehnung**, um bestimmte Dateien zu referenzieren. Dann muss der Agent nicht danach suchen.
3. **Lass den Agent Tools verketten.** Eine einzelne Anfrage wie "Finde alle Notizen ueber X, fasse sie zusammen und erstelle eine neue Notiz mit der Zusammenfassung" verwendet automatisch mehrere Tools.
4. **Pruefe den Activity Block**, um genau zu sehen, welche Dateien gelesen oder geaendert wurden.
5. **Starte im Ask-Mode**, wenn du nur erkunden moechtest. Wechsle zum Agent-Mode, wenn du bereit bist, Aenderungen vorzunehmen.

## Naechste Schritte

- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche und der Wissensgraph
- [Chat-Oberflaeche](/de/guide/working-with-obsilo/chat-interface) -- Anhaenge, Verlauf und Tastenkuerzel
- [Office-Dokumente](/de/guide/advanced/office-documents) -- PPTX, DOCX und XLSX aus deinen Notizen erstellen
