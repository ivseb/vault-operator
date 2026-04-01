---
title: Tool-Referenz
description: Vollständige Liste aller 49+ Tools des Obsilo-Agents, nach Gruppen geordnet.
---

# Tool-Referenz

Obsilo verfügt über 49+ eingebaute Tools, organisiert in sechs Gruppen. Der Agent wählt automatisch das passende Tool basierend auf deiner Anfrage -- du musst Tools nie selbst aufrufen. Diese Seite dient als Nachschlagewerk.

:::tip So funktionieren Tools
Wenn du Obsilo um etwas bittest, wählt er ein oder mehrere Tools aus, zeigt dir im Activity-Block, was er vorhat, und fragt vor jeder Schreiboperation um Genehmigung. Siehe [Sicherheit & Kontrolle](/de/guide/working-with-obsilo/safety-control) für Details.
:::

## Tool-Gruppen im Überblick

| Gruppe | Tools | Ändert Vault | Genehmigung nötig |
|--------|-------|-------------|-------------------|
| Read | 4 | Nein | Nein |
| Vault Intelligence | 8 | Nein (außer `open_note`) | Nein |
| Edit | 15 | Ja | Ja |
| Web | 2 | Nein | Ja (externer Zugriff) |
| Agent Control | 12 | Variiert | Variiert |
| Plugin Integration | 6 | Variiert | Ja |
| MCP | 1+ | Abhängig vom Server | Ja |

## Read-Tools

Tools zum Lesen, Suchen und Erkunden deines Vaults. Sie verändern niemals etwas.

| Tool | Beschreibung | Wann verwenden |
|------|-------------|----------------|
| `read_file` | Liest den vollständigen Inhalt einer Markdown- oder Textdatei. | Vor dem Bearbeiten einer Datei, oder wenn du Inhalte sehen möchtest. |
| `read_document` | Parst und extrahiert Text aus Office- und Datendateien (PPTX, XLSX, DOCX, PDF, JSON, XML, CSV). | Für binäre Dokumentformate -- nicht für Textdateien. |
| `list_files` | Listet Dateien und Ordner in einem Verzeichnis auf, optional rekursiv. | Um die Ordnerstruktur zu erkunden oder Dateien nach Speicherort zu finden. |
| `search_files` | Sucht nach Text oder Regex-Mustern in Dateien und gibt übereinstimmende Zeilen mit Zeilennummern zurück. | Für exakte Text- oder Mustersuche im gesamten Vault. |

## Vault Intelligence-Tools

Tools, die die Struktur, Metadaten und Verbindungen deines Vaults verstehen.

| Tool | Beschreibung | Wann verwenden |
|------|-------------|----------------|
| `get_vault_stats` | Überblick über deinen Vault -- Anzahl der Notizen, Ordnerstruktur, häufigste Tags, zuletzt geänderte Dateien. | Wenn du ein Gesamtbild deines Vaults brauchst. |
| `get_frontmatter` | Liest alle YAML-Frontmatter-Felder einer Notiz (Tags, Aliase, Daten, Status, eigene Eigenschaften). | Um Metadaten zu prüfen, bevor du sie aktualisierst. |
| `search_by_tag` | Findet alle Notizen mit bestimmten Tags, unterstützt AND/OR-Verknüpfung und verschachtelte Tags. | Um Notizen nach Tags oder Kategorien zu filtern. |
| `get_linked_notes` | Gibt Forward-Links und Backlinks für eine Notiz zurück. | Um zu verstehen, wie Notizen im Graphen zusammenhängen. |
| `get_daily_note` | Liest (oder erstellt) eine Daily Note für heute, gestern oder einen beliebigen Offset. | Um mit deinen täglichen Notizen zu arbeiten. |
| `open_note` | Öffnet eine Notiz im Obsidian-Editor. | Nach dem Erstellen oder Bearbeiten einer Notiz, damit du das Ergebnis sehen kannst. |
| `semantic_search` | Findet Notizen nach Bedeutung mittels KI-gestützter Ähnlichkeitssuche. | Für Fragen in natürlicher Sprache über Vault-Inhalte ("Was weiß ich über X?"). |
| `query_base` | Fragt eine Obsidian-Bases-Datenbankdatei ab und gibt passende Datensätze zurück. | Um strukturierte Daten aus einer .base-Datei abzurufen. |

:::info Semantic Search einrichten
`semantic_search` benötigt ein Embedding-Modell und einen aufgebauten Index. Konfiguriere beides unter **Settings > Embeddings**. Siehe [Wissensrecherche](/de/guide/working-with-obsilo/knowledge-discovery) für Einrichtungshinweise.
:::

## Edit-Tools

Tools, die Dateien in deinem Vault erstellen, ändern oder löschen. Jedes löst eine Genehmigungsabfrage aus (sofern nicht automatisch genehmigt).

| Tool | Beschreibung | Wann verwenden |
|------|-------------|----------------|
| `write_file` | Erstellt eine neue Datei oder ersetzt den Inhalt einer bestehenden Datei vollständig. | Für neue Dateien oder vollständige Neuschreiben. |
| `edit_file` | Ersetzt einen bestimmten Text in einer bestehenden Datei und behält den umgebenden Inhalt bei. | Für gezielte Änderungen -- die bevorzugte Methode zur Dateibearbeitung. |
| `append_to_file` | Hängt Inhalt am Ende einer Datei an. | Für Daily Notes, Protokolle und additive Einträge. |
| `update_frontmatter` | Setzt, aktualisiert oder entfernt Frontmatter-Felder, ohne den Notizinhalt zu verändern. | Um Metadaten (Tags, Status, Daten) sauber zu ändern. |
| `create_folder` | Erstellt einen neuen Ordner, inklusive übergeordneter Ordner falls nötig. | Bevor du Dateien an einem neuen Speicherort schreibst. |
| `delete_file` | Verschiebt eine Datei oder einen leeren Ordner in den Papierkorb (wiederherstellbar). | Wenn du ausdrücklich darum bittest, etwas zu löschen. |
| `move_file` | Verschiebt oder benennt eine Datei oder einen Ordner um. Obsidian aktualisiert Wikilinks automatisch. | Um die Vault-Struktur neu zu organisieren. |
| `generate_canvas` | Erstellt ein Obsidian Canvas (.canvas), das Notizen und ihre Verbindungen visualisiert. | Um Notizenbeziehungen als räumliche Karte darzustellen. |
| `create_excalidraw` | Erstellt eine Excalidraw-Zeichnung mit beschrifteten Boxen und Verbindungen. | Um Diagramme und visuelle Übersichten zu erstellen. |
| `create_base` | Erstellt eine Obsidian-Bases-Datenbankansicht (.base) aus Vault-Notizen. | Um strukturierte Datenbankansichten zu erstellen, gefiltert nach Frontmatter. |
| `update_base` | Fügt eine Ansicht in einer bestehenden Bases-Datei hinzu oder ersetzt sie. | Um Datenbankansichten zu ändern, ohne die Datei neu zu erstellen. |
| `plan_presentation` | Plant eine Präsentation aus Quellmaterial und Template mittels internem KI-Aufruf. | Immer vor `create_pptx`, wenn Corporate-Templates verwendet werden. |
| `create_pptx` | Erstellt eine PowerPoint-Präsentation (.pptx) aus strukturierten Foliendaten. | Zum Erstellen von PowerPoint-Dateien. |
| `create_docx` | Erstellt ein Word-Dokument (.docx) mit Überschriften, Abschnitten, Aufzählungen und Tabellen. | Zum Erstellen von Word-Dokumenten. |
| `create_xlsx` | Erstellt eine Excel-Tabelle (.xlsx) mit Blättern, Kopfzeilen, Datenzeilen und Formeln. | Zum Erstellen von Excel-Dateien. |

## Web-Tools

Tools für den Internetzugriff. Web Tools müssen in den Einstellungen aktiviert sein.

| Tool | Beschreibung | Wann verwenden |
|------|-------------|----------------|
| `web_fetch` | Ruft eine URL ab und gibt den Inhalt als Markdown zurück. Unterstützt Paginierung für lange Seiten. | Um eine bestimmte Webseite, Dokumentation oder einen Artikel zu lesen. |
| `web_search` | Durchsucht das Web und gibt Titel, URLs und Ausschnitte zurück. | Für aktuelle oder externe Informationen, die nicht in deinem Vault sind. |

## Agent Control-Tools

Interne Tools, die der Agent zur Steuerung seines eigenen Workflows nutzt.

| Tool | Beschreibung | Wann verwenden |
|------|-------------|----------------|
| `ask_followup_question` | Stellt dir eine klärende Frage mit optionalen Antwortvorschlägen. | Wenn deine Anfrage tatsächlich mehrdeutig ist. |
| `attempt_completion` | Signalisiert, dass eine mehrstufige Aufgabe abgeschlossen ist, und protokolliert eine Zusammenfassung. | Nach Abschluss eines Tool-basierten Workflows. |
| `update_todo_list` | Veröffentlicht eine sichtbare Aufgaben-Checkliste für komplexe mehrstufige Arbeiten. | Für Aufgaben mit 3 oder mehr einzelnen Schritten. |
| `new_task` | Startet einen Sub-Agent mit frischem Kontext für isolierte oder parallele Arbeit. | Für komplexe Aufgaben (5+ Schritte), bei denen Delegation sinnvoll ist. |
| `switch_mode` | Wechselt in einen anderen Agent-Modus (z.B. von Ask zu Agent). | Wenn die aktuelle Aufgabe andere Tools oder anderes Verhalten erfordert. |
| `evaluate_expression` | Führt TypeScript-Code in einer isolierten Sandbox mit Vault-Zugriff aus. | Für Batch-Operationen, Berechnungen, Datentransformationen oder API-Aufrufe jenseits der eingebauten Tools. |
| `manage_skill` | Erstellt, aktualisiert, löscht oder listet Skills (persistente Anleitungen). | Um einen wiederverwendbaren Ansatz für einen bestimmten Aufgabentyp zu speichern. |
| `manage_source` | Verwaltet Context Sources -- persistente Textblöcke, die in jede Konversation eingefügt werden. | Um bestimmten Kontext wie Projektregeln immer einzubeziehen. |
| `manage_mcp_server` | Fügt MCP-Server-Verbindungen hinzu, entfernt oder testet sie. | Um externe Tool-Server anzubinden. |
| `configure_model` | Fügt eine LLM-Modellkonfiguration hinzu, wählt sie aus oder testet sie. | Um ein neues KI-Modell einzurichten oder das aktive zu wechseln. |
| `update_settings` | Ändert Obsilo-Plugin-Einstellungen oder wendet Berechtigungs-Presets an. | Wenn du den Agent bittest, seine eigene Konfiguration anzupassen. |
| `read_agent_logs` | Liest die internen Konsolen-Logs des Agents zur Selbstdiagnose. | Um Fehler zu diagnostizieren oder nachzuvollziehen, was passiert ist. |

## Plugin Integration-Tools

Tools, die mit anderen installierten Obsidian-Plugins in deinem Vault interagieren.

| Tool | Beschreibung | Wann verwenden |
|------|-------------|----------------|
| `execute_command` | Führt einen Obsidian-Befehl per ID aus (z.B. "daily-notes:open"). | Um Befehle beliebiger Plugins auszulösen. |
| `call_plugin_api` | Ruft eine JavaScript-API-Methode eines Plugins auf (Dataview, Omnisearch etc.). | Um strukturierte Daten von Plugins abzurufen. |
| `enable_plugin` | Aktiviert oder deaktiviert ein installiertes Community-Plugin. | Wenn ein deaktiviertes Plugin für eine Aufgabe benötigt wird. |
| `resolve_capability_gap` | Sucht nach Plugins, die helfen könnten, wenn kein eingebautes Tool passt. | Wenn der Agent eine Anfrage mit vorhandenen Tools nicht erfüllen kann. |
| `execute_recipe` | Führt ein vordefiniertes Recipe für externe CLI-Tools aus (z.B. Pandoc-Export). | Für validierte Kommandozeilen-Integrationen. |
| `render_presentation` | Rendert eine PPTX-Datei als Bilder zur visuellen Qualitätsprüfung. | Nach dem Erstellen einer Präsentation, um Layout und Inhalt zu überprüfen. |

## MCP-Tools

| Tool | Beschreibung | Wann verwenden |
|------|-------------|----------------|
| `use_mcp_tool` | Ruft ein beliebiges Tool eines verbundenen MCP-Servers auf. | Wenn ein externer MCP-Server die benötigte Funktionalität bietet. |

:::tip Custom Modes steuern den Tool-Zugriff
Jeder Modus (Ask, Agent oder deine eigenen Modi) kann bestimmte Tool-Gruppen aktivieren oder deaktivieren. Konfiguriere Tools pro Modus unter **Settings > Modes**. Der Ask-Modus hat beispielsweise standardmäßig nur Read-Tools aktiviert.
:::

## Schnellauswahl

Nicht sicher, welches Tool der Agent verwenden soll? Diese Tabelle ordnet häufige Aufgaben dem richtigen Tool zu.

| Du möchtest... | Bestes Tool | Warum nicht die Alternative |
|----------------|------------|----------------------------|
| Notizen zu einem Thema finden | `semantic_search` | `search_files` findet nur exakten Text, keine Bedeutung |
| Eine exakte Phrase finden | `search_files` | `semantic_search` findet ähnliche Bedeutungen, keine exakten Treffer |
| Die Tags einer Notiz prüfen | `get_frontmatter` | `read_file` liest die gesamte Datei -- für Metadaten unnötig |
| Einen Absatz zu einer Notiz hinzufügen | `edit_file` | `write_file` ersetzt die gesamte Datei |
| Einen Eintrag in ein Protokoll einfügen | `append_to_file` | `edit_file` erfordert das Finden bestehenden Texts |
| Ein Word-Dokument erstellen | `create_docx` | `write_file` kann kein binäres .docx-Format erzeugen |
| Eine PowerPoint-Präsentation erstellen | `plan_presentation` dann `create_pptx` | Ohne `plan_presentation` bleiben Formen leer |
| Eine PDF- oder PPTX-Datei lesen | `read_document` | `read_file` gibt für Nicht-Text-Formate Roh-Binärdaten zurück |
| Eine Dataview-Abfrage ausführen | `call_plugin_api` | `search_files` kann keine Dataview-Logik ausführen |
| 50 Dateien gleichzeitig verarbeiten | `evaluate_expression` | `edit_file` 50-mal aufzurufen ist langsam und fehleranfällig |
| Etwas im Internet nachschlagen | `web_search` dann `web_fetch` | Vault-Tools durchsuchen nur lokale Dateien |
| Eine visuelle Karte von Notizen erstellen | `generate_canvas` | Manuelles Anordnen von Notizen ist mühsam |

## Hinweise zum Tool-Verhalten

- **Read-Tools laufen parallel.** Wenn der Agent mehrere Dateien lesen muss, liest er sie alle gleichzeitig -- für mehr Geschwindigkeit.
- **Edit-Tools laufen sequenziell.** Schreiboperationen werden einzeln abgearbeitet, um Konflikte zu vermeiden.
- **Checkpoints sind automatisch.** Bevor ein Edit-Tool eine Datei ändert, wird ein Snapshot erstellt. Du kannst jede Änderung rückgängig machen.
- **Die Sandbox ist isoliert.** Code in `evaluate_expression` läuft in einer abgeschotteten Umgebung mit eingeschränktem Vault-Zugriff -- er kann nicht direkt auf das Dateisystem zugreifen oder Shell-Befehle ausführen.
- **Office-Tools erzeugen Binärdateien.** `create_pptx`, `create_docx` und `create_xlsx` erstellen echte Office-Dateien, die sich in Microsoft Office, Google Docs oder LibreOffice öffnen lassen.
- **Quality Gates gelten.** Einige Tools (`create_pptx`, `create_docx`, `create_xlsx`, `generate_canvas`, `create_excalidraw`) enthalten einen Selbstprüfungsschritt, bei dem der Agent kontrolliert, ob das Ergebnis den Qualitätsstandards entspricht.
