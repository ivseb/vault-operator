---
title: Einstellungen-Referenz
description: Jede Obsilo-Einstellung erklärt -- nach Tabs geordnet mit Standardwerten und Empfehlungen.
---

# Einstellungen-Referenz

Alle Obsilo-Einstellungen findest du unter **Obsidian Settings > Obsilo Agent**. Diese Seite dokumentiert jeden Bereich.

## Models

Konfiguriere KI-Modelle und Provider. Du kannst mehrere Modelle hinzufügen und zwischen ihnen wechseln.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Model list | Alle konfigurierten Modelle mit Provider, Name und Status | Leer | Füge mindestens ein Modell hinzu, um zu starten |
| Active model | Das Modell, das für Konversationen verwendet wird | Ersthinzugefügtes | Nutze ein leistungsfähiges Modell (Claude Sonnet, GPT-4o) |
| + add model | Öffnet den Modellkonfigurations-Dialog | -- | Starte mit einem Cloud- und einem lokalen Modell |
| Import from code | Importiere Modellkonfigurationen aus Code-Snippets | -- | Nützlich für Team-Setups |
| Test connection | Überprüfe, ob API-Key und Endpunkt eines Modells funktionieren | -- | Immer nach dem Hinzufügen eines neuen Modells testen |

:::tip Mehrere Modelle
Füge mehrere Modelle hinzu und weise sie verschiedenen Modi zu. Nutze ein schnelles/günstiges Modell für den Ask-Modus und ein leistungsstarkes für den Agent-Modus.
:::

## Embeddings

Konfiguriere den semantischen Index für bedeutungsbasierte Vault-Suche.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Embedding model | Das Modell zur Erzeugung von Text-Embeddings | Keins | OpenAI `text-embedding-3-small` (günstigste Option) |
| API key | Separater Key für den Embedding-Provider | Keins | Kann den OpenAI-Key aus Models teilen |
| Auto-index | Notizen automatisch indizieren, wenn sie sich ändern | Aus | Aktivieren für Vaults unter 5.000 Notizen |
| Rebuild index | Den gesamten Vault von Grund auf neu indizieren | -- | Nach der Ersteinrichtung oder größeren Vault-Änderungen ausführen |
| Reranking | Semantic-Search-Ergebnisse für bessere Relevanz neu ordnen | Aus | Aktivieren, wenn Suchergebnisse ungenau wirken |
| Implicit connections | Verborgene Beziehungen zwischen Notizen entdecken | Aus | Aktivieren für Wissensrecherche-Szenarien |
| Graph enrichment | Semantische Ähnlichkeitsdaten zum Obsidian-Graph hinzufügen | Aus | Aktivieren, wenn du die Graph-Ansicht intensiv nutzt |

:::info Index-Größe
Der semantische Index speichert Embeddings lokal. Für einen Vault mit 1.000 Notizen rechne mit etwa 10-20 MB Speicherplatz.
:::

## Web Search

Aktiviere Tools für den Internetzugriff.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Enable web tools | Dem Agent erlauben, `web_fetch` und `web_search` zu nutzen | Aus | Aktivieren, wenn du aktuelle Informationen brauchst |
| Search provider | Welche Such-API verwendet wird | Brave | Brave (kostenlose Stufe) oder Tavily (bessere Ergebnisse) |
| API key | Key für den gewählten Suchanbieter | Keins | Hole dir einen kostenlosen Key bei deinem gewählten Anbieter |

## MCP (Model Context Protocol)

Verbinde externe Tool-Server und stelle Obsilo als Server bereit.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Client servers | Liste der MCP-Server, deren Tools der Agent nutzen kann | Leer | Server für externe Integrationen hinzufügen |
| + add server | Neue MCP-Server-Verbindung konfigurieren (SSE oder Streamable HTTP) | -- | Nur SSE- und Streamable-HTTP-Transporte funktionieren |
| Test server | Konnektivität zu einem konfigurierten Server überprüfen | -- | Nach dem Hinzufügen testen |
| Obsilo as MCP server | Obsilos Tools für externe Clients wie Claude Desktop bereitstellen | Aus | Aktivieren, um Obsilo von Claude Desktop aus zu nutzen |

:::info Transport-Einschränkung
Obsilo läuft innerhalb von Electron (Obsidians Runtime), daher werden nur **SSE**- und **Streamable-HTTP**-Transporte unterstützt. Stdio-basierte MCP-Server funktionieren nicht.
:::

## Modes

Konfiguriere Agent-Modi -- jeder Modus definiert, welche Tools, Skills und welches Modell der Agent verwendet.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Ask mode | Nur-Lese-Modus mit nur Read- und Vault Intelligence-Tools | Eingebaut | Als sicheren Erkundungsmodus beibehalten |
| Agent mode | Vollzugriffsmodus mit allen aktivierten Tools | Eingebaut | Dein primärer Arbeitsmodus |
| Custom modes | Benutzerdefinierte Modi mit eigenen Tool-Sets und System-Prompts | Leer | Modi für bestimmte Workflows erstellen (Researcher, Writer) |
| Per-mode model | Überschreibt, welches Modell ein Modus verwendet | Globales Modell | Schnelles Modell für Ask, leistungsstarkes für Agent |
| Per-mode tools | Auswahl, welche Tool-Gruppen in jedem Modus verfügbar sind | Variiert je Modus | Tools auf das beschränken, was der Modus tatsächlich braucht |
| Per-mode skills | Bestimmte Skills einem Modus zuordnen | Keine | Relevante Skills für den Zweck des Modus zuordnen |

## Permissions (Auto-Approve)

Steuere, was der Agent ohne Nachfrage tun darf. Siehe [Sicherheit & Kontrolle](/de/guide/working-with-obsilo/safety-control) für Details.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Read operations | Datei-Lesevorgänge, Suchen und Auflistungen automatisch genehmigen | Aus | Unbedenklich zu aktivieren -- nichts wird verändert |
| Note edits | Bearbeiten bestehender Notizen automatisch genehmigen | Aus | Aktivieren, wenn du den Bearbeitungen des Agents vertraust |
| Vault changes | Erstellen, Verschieben, Löschen von Dateien automatisch genehmigen | Aus | Deaktiviert lassen, bis du dich sicher fühlst |
| Web operations | Web-Abrufe und -Suchen automatisch genehmigen | Aus | Aktivieren, wenn du Web-Tools häufig nutzt |
| MCP calls | Aufrufe an externe MCP-Server automatisch genehmigen | Aus | Pro Server basierend auf Vertrauen aktivieren |
| Subtasks | Starten von Sub-Agents automatisch genehmigen | Aus | Unbedenklich zu aktivieren -- erbt Berechtigungen des übergeordneten Agents |
| Plugin skills | Ausführung von Plugin-Befehlen automatisch genehmigen | Aus | Für vertrauenswürdige Plugin-Workflows aktivieren |
| Plugin API reads | Lesen von Plugin-Daten automatisch genehmigen | Aus | Unbedenklich zu aktivieren -- nur lesend |
| Plugin API writes | Ändern von Plugin-Einstellungen automatisch genehmigen | Aus | Deaktiviert lassen -- hohes Risiko |
| Recipes | Mehrstufige CLI-Recipes automatisch genehmigen | Aus | Deaktiviert lassen -- führt externe Befehle aus |
| Sandbox | Code-Ausführung in der Sandbox automatisch genehmigen | Aus | Deaktiviert lassen, sofern du generiertem Code nicht vertraust |

:::warning Permissive Kombination
Die gleichzeitige Aktivierung von **Web operations** und **Note edits** (oder Vault changes) löst eine Sicherheitswarnung aus. Diese Kombination erlaubt dem Agent, Internetinhalte abzurufen und ohne Nachfrage in deinen Vault zu schreiben.
:::

## Loop (Agent-Verhalten)

Steuere den Ablauf der Agent-Schleife.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Consecutive error limit | Wie viele aufeinanderfolgende Tool-Fehler, bevor der Agent stoppt | 3 | Bei 3 belassen -- verhindert endlose Fehlerschleifen |
| Rate limit | Minimale Millisekunden zwischen API-Aufrufen | 0 | Auf 500-1000 setzen, falls du Rate Limits erreichst |
| Max iterations | Maximale Tool-Aufrufe pro Konversations-Runde | 25 | Für komplexe Aufgaben erhöhen, zum Kostensparen senken |
| Context condensing | Ältere Nachrichten zusammenfassen, wenn der Kontext lang wird | An | Aktiviert lassen -- verhindert Context-Overflow-Fehler |
| Condensing threshold | Prozentsatz des Kontextfensters, bevor Condensing auslöst | 70% | Senken, falls du 400-Fehler wegen Context Overflow siehst |
| Power steering | Schlüsselanweisungen alle N Nachrichten erneut einfügen | 4 | Bei 4 belassen für konsistentes Verhalten |
| Subtask depth | Maximale Verschachtelungstiefe für Sub-Agents | 2 | Bei 2 belassen, außer du brauchst tiefe Delegation |

## Memory

Konfiguriere, wie sich der Agent über Konversationen hinweg erinnert.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Chat history | Konversationsverlauf für spätere Referenz speichern | An | Aktiviert lassen -- essentiell für Memory-Extraktion |
| Chat history folder | Wo Konversationsdateien im Vault gespeichert werden | `Obsilo/Chats` | Ändern, falls du einen anderen Speicherort bevorzugst |
| Memory extraction | Automatisch Kernfakten aus Konversationen extrahieren | An | Aktiviert lassen für Personalisierung |
| Memory model | Welches Modell für die Memory-Extraktion verwendet wird (Hintergrundprozess) | Globales Modell | Ein günstiges Modell (Haiku, GPT-4o-mini) nutzen, um Kosten zu sparen |
| Memory threshold | Minimaler Relevanzwert, damit ein Memory gespeichert wird | 0,7 | Senken für mehr Erinnerungen, erhöhen für weniger, aber höhere Qualität |

## Rules

Persistente Anweisungen, die den Agent in jeder Konversation leiten.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Rule list | Alle aktiven Regeln, die in den System-Prompt eingefügt werden | Leer | Regeln für deinen Schreibstil und Vault-Konventionen hinzufügen |
| + add rule | Eine neue Regel erstellen (Klartext oder Markdown) | -- | Regeln knapp und spezifisch halten |
| Import | Regeln aus einer Datei importieren | -- | Regeln über Vaults hinweg teilen |

## Workflows & Prompts

Vordefinierte mehrstufige Anleitungen und Prompt-Vorlagen.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Workflows | Per Slash-Befehl ausgelöste Anleitungssequenzen (tippe `/` im Chat) | Eingebaute Defaults | Workflows für deine wiederkehrenden Aufgaben erstellen |
| Prompts | Wiederverwendbare Nachrichtenvorlagen mit optionalen Variablen | Leer | Prompts für häufige Fragen erstellen |

## Skills

Persistente Anleitungen, die per Schlüsselwörtern zugeordnet werden -- wie Mini-Handbücher, denen der Agent folgt.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Skill list | Alle Skills mit Name, Trigger-Pattern und Inhalt | Eingebaute Defaults | Skills für fachspezifische Aufgaben hinzufügen |
| + add skill | Einen neuen Skill erstellen | -- | Ein klares Trigger-Pattern und Schritt-für-Schritt-Anleitung einbeziehen |

## Interface

Einstellungen für Erscheinungsbild und Eingabeverhalten.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Auto-add active file | Automatisch die aktuell geöffnete Notiz als Kontext einbeziehen | An | Aktiviert lassen -- hilft dem Agent zu verstehen, was du gerade siehst |
| Send key | Welche Taste eine Nachricht sendet (Enter oder Ctrl/Cmd+Enter) | Enter | Auf Ctrl+Enter umstellen, wenn du oft mehrzeilige Nachrichten schreibst |
| Show date/time | Zeitstempel im Chat anzeigen | Aus | Persönliche Präferenz |
| Chat history folder | Vault-Ordner für gespeicherte Konversationen | `Obsilo/Chats` | Auch im Memory-Tab konfigurierbar |
| Chat linking | Chat-Sitzungen mit Notizen für Nachverfolgbarkeit verknüpfen | Aus | Für projektbasierte Workflows aktivieren |
| Task extraction | Aufgaben aus Agent-Antworten erkennen und extrahieren | Aus | Aktivieren, um automatisch Tasks aus Konversationen zu erstellen |

## Shell (Plugin API & Recipes)

Konfiguriere Integrationen externer Tools.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Plugin API | Dem Agent erlauben, JavaScript-APIs anderer Plugins aufzurufen | Aus | Aktivieren, wenn du Dataview, Omnisearch oder Ähnliches nutzt |
| Command allowlist | Welche Obsidian-Befehle der Agent ausführen darf | Keine | Bestimmte Command-IDs hinzufügen, denen du vertraust |
| Recipes | Vorvalidierte CLI-Tool-Recipes (z.B. Pandoc-Export) | Eingebaut | Nur Recipes für Tools hinzufügen, die du installiert hast |

## Vault (Checkpoints)

Checkpoint- und Snapshot-Einstellungen für das Undo-System.

| Einstellung | Was sie bewirkt | Standard | Empfehlung |
|------------|----------------|----------|------------|
| Enable checkpoints | Snapshots vor Dateiänderungen erstellen | An | Aktiviert lassen -- das ist die Grundlage des Undo-Systems |
| Snapshot timeout | Maximale Wartezeit für einen Snapshot (ms) | 5000 | Für sehr große Dateien erhöhen |
| Auto-cleanup | Alte Checkpoints automatisch entfernen | An | Aktiviert lassen, um Speicherplatz zu sparen |

## Weitere Tabs

| Tab | Was er bewirkt |
|-----|---------------|
| **Log** | Tägliches Audit-Protokoll aller Tool-Aufrufe mit Zeitstempeln und Parametern durchsuchen |
| **Debug** | Interne Diagnose -- Ring-Buffer-Viewer, System-Prompt-Vorschau |
| **Backup** | Deine gesamte Obsilo-Konfiguration exportieren und importieren |
| **Language** | Die Antwortsprache des Agents festlegen (folgt standardmäßig Obsidians Sprache) |
| **Visual Intelligence** | LibreOffice-basiertes Rendering für Präsentations-Qualitätsprüfungen aktivieren |
