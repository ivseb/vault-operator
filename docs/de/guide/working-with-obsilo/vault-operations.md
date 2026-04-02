---
title: Vault-Operationen
description: Wie Obsilo deinen Vault liest, beschreibt, durchsucht und strukturiert.
---

# Vault-Operationen

Obsilo kann Dateien in deinem gesamten Vault lesen, schreiben, durchsuchen und organisieren. Diese Seite erklärt, was der Agent kann, wie jede Operation funktioniert und wann du sie einsetzen würdest.

## Wie es funktioniert

Der Agent greift nicht direkt auf deinen Vault zu. Er verwendet **Tools** -- kleine, spezialisierte Funktionen, die jeweils eine bestimmte Aufgabe erledigen. Wenn du den Agent bittest, eine Notiz zu finden oder eine Datei zu erstellen, wählt er die passenden Tools aus und ruft sie in deinem Auftrag auf.

Jeder Tool Call ist im [Activity Block](/de/guide/working-with-obsilo/chat-interface#activity-blocks) sichtbar, und Schreiboperationen erfordern eine [Genehmigung](/de/guide/working-with-obsilo/safety-control), sofern du Auto-Approve nicht aktiviert hast.

## Deinen Vault lesen

Diese Tools lassen den Agent deine Dateien ansehen, ohne etwas zu verändern. Sie sind sowohl im **Ask**- als auch im **Agent**-Mode verfügbar.

| Tool | Was es tut |
|------|-----------|
| **read_file** | Öffnet eine Notiz und liest ihren Inhalt |
| **list_files** | Listet Dateien und Ordner in einem bestimmten Pfad auf |
| **search_files** | Findet Notizen anhand von Textinhalten (Keyword-Suche) |
| **search_by_tag** | Findet alle Notizen mit einem bestimmten Tag |
| **get_frontmatter** | Liest die YAML-Metadaten am Anfang einer Notiz |
| **get_linked_notes** | Folgt Wikilinks und Backlinks ausgehend von einer Notiz |
| **get_daily_note** | Öffnet die heutige Daily Note (oder ein bestimmtes Datum) |

### Praktische Beispiele

- *"Welche Notizen habe ich im Projects-Ordner?"* -- nutzt `list_files`
- *"Finde alles, was ich über Client-Onboarding geschrieben habe"* -- nutzt `search_files`
- *"Zeig mir alle Notizen mit dem Tag #review"* -- nutzt `search_by_tag`
- *"Was verlinkt auf meine Quartalszeile-Notiz?"* -- nutzt `get_linked_notes`
- *"Lies die heutige Daily Note"* -- nutzt `get_daily_note`

:::tip Semantische Suche geht weiter
Keyword-Suche findet exakte Wörter. Um Notizen nach Bedeutung zu finden (z.B. "Notizen über besseren Schlaf" findet eine Notiz mit dem Titel "Abendroutine"), siehe [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery).
:::

## Schreiben und Bearbeiten

Diese Tools verändern deinen Vault. Sie sind nur im **Agent**-Mode verfügbar und erfordern standardmäßig eine Genehmigung.

| Tool | Was es tut |
|------|-----------|
| **write_file** | Erstellt eine neue Notiz oder ersetzt eine bestehende |
| **edit_file** | Nimmt gezielte Änderungen an einem Teil einer Notiz vor |
| **append_to_file** | Fügt Inhalt am Ende einer bestehenden Notiz hinzu |
| **update_frontmatter** | Ändert YAML-Metadatenfelder |

### Praktische Beispiele

- *"Erstelle eine Notiz, die unsere Q1-Ergebnisse zusammenfasst"* -- nutzt `write_file`
- *"Ersetze den zweiten Absatz in @project-brief durch eine kürzere Version"* -- nutzt `edit_file`
- *"Füge die heutigen Action Items zu @task-list hinzu"* -- nutzt `append_to_file`
- *"Setze das Status-Feld in @project-brief auf 'complete'"* -- nutzt `update_frontmatter`

:::info Checkpoints schützen deine Dateien
Vor jeder Schreiboperation speichert Obsilo einen Snapshot der Datei. Falls etwas schiefgeht, klicke auf **Undo** in der [Undo-Leiste](/de/guide/working-with-obsilo/chat-interface#die-undo-leiste), um das Original wiederherzustellen.
:::

## Dateien und Ordner organisieren

Diese Tools helfen dir, deinen Vault umzustrukturieren.

| Tool | Was es tut |
|------|-----------|
| **create_folder** | Erstellt einen neuen Ordner (einschließlich verschachtelter Pfade) |
| **move_file** | Verschiebt eine Notiz in einen anderen Ordner oder benennt sie um |
| **delete_file** | Verschiebt eine Notiz in den Obsidian-Papierkorb |

### Praktische Beispiele

- *"Erstelle einen Archive/2025-Ordner und verschiebe alle Notizen mit dem Tag #archived dorthin"* -- nutzt `create_folder` + `move_file`
- *"Benenne @old-project-name in new-project-name um"* -- nutzt `move_file`
- *"Lösche alle leeren Notizen im Inbox-Ordner"* -- nutzt `delete_file`

:::warning Löschen nutzt den Obsidian-Papierkorb
Gelöschte Dateien landen im Obsidian-Papierkorb (`.trash`-Ordner), nicht in der dauerhaften Löschung. Du kannst sie von dort wiederherstellen. Dies folgt dem Standard-Dateiverwaltungsverhalten von Obsidian.
:::

## Vault-Statistiken

Der Agent kann dir mit **get_vault_stats** einen Überblick über deinen Vault geben:

- Gesamtzahl der Notizen, Ordner und Anhänge
- Vault-Größe
- Tag-Verteilung
- Zuletzt geänderte Dateien

**Beispiel:** *"Gib mir eine Zusammenfassung meines Vaults -- wie viele Notizen, was sind die meistgenutzten Tags?"*

## Canvas und visuelle Karten

Obsilo kann visuelle Darstellungen deiner Notizen und ihrer Beziehungen erstellen.

| Tool | Was es tut |
|------|-----------|
| **generate_canvas** | Erstellt ein Obsidian Canvas (.canvas) mit Karten und Verbindungen |
| **create_excalidraw** | Erstellt eine Excalidraw-Zeichnung (erfordert das Excalidraw-Plugin) |

**Beispiel:** *"Erstelle eine Canvas-Karte, die alle Notizen im Projects-Ordner und ihre Verbindungen zeigt"*

## Bases (strukturierte Daten)

Mit Bases kannst du deine Notizen als strukturierte Daten nutzen -- ähnlich einer Datenbankansicht.

| Tool | Was es tut |
|------|-----------|
| **create_base** | Erstellt eine neue Base aus Notizen, die bestimmte Kriterien erfüllen |
| **query_base** | Fragt eine bestehende Base mit Filtern und Sortierung ab |
| **update_base** | Ändert Einträge in einer Base |

**Beispiel:** *"Erstelle eine Base aller Notizen mit dem Tag #book mit Spalten für Autor, Bewertung und Status aus dem Frontmatter"*

:::info Erfordert Obsidian Bases
Die Bases-Funktion nutzt Obsidians integrierte Bases-Funktionalität. Stelle sicher, dass deine Obsidian-Version diese unterstützt (1.8+).
:::

## Tipps für Vault-Operationen

1. **Sei spezifisch bei Pfaden.** "Der Projects-Ordner" ist klarer als "meine Projektnotizen".
2. **Nutze @-Erwähnung**, um bestimmte Dateien zu referenzieren. Dann muss der Agent nicht danach suchen.
3. **Lass den Agent Tools verketten.** Eine einzelne Anfrage wie "Finde alle Notizen über X, fasse sie zusammen und erstelle eine neue Notiz mit der Zusammenfassung" verwendet automatisch mehrere Tools.
4. **Prüfe den Activity Block**, um genau zu sehen, welche Dateien gelesen oder geändert wurden.
5. **Starte im Ask-Mode**, wenn du nur erkunden möchtest. Wechsle zum Agent-Mode, wenn du bereit bist, Änderungen vorzunehmen.

## Nächste Schritte

- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche und der Wissensgraph
- [Chat-Oberfläche](/de/guide/working-with-obsilo/chat-interface) -- Anhänge, Verlauf und Tastenkürzel
- [Office-Dokumente](/de/guide/advanced/office-documents) -- PPTX, DOCX und XLSX aus deinen Notizen erstellen
