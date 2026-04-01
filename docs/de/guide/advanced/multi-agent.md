---
title: Multi-Agent & Tasks
description: Sub-Tasks, Task-Extraktion und wie Obsilo Arbeit an untergeordnete Agents delegiert.
---

# Multi-Agent & Tasks

Bei komplexen Aufgaben kann eine einzelne Agent-Konversation unübersichtlich werden. Obsilo löst das mit Sub-Agents -- untergeordneten Agents, die bestimmte Teile einer größeren Aufgabe eigenständig bearbeiten. Außerdem extrahiert es umsetzbare Aufgaben aus Konversationen und wandelt sie in nachverfolgbare Notizen um.

## Was sind Sub-Agents?

Ein Sub-Agent ist eine separate Agent-Instanz, die vom Haupt-Agent gestartet wird. Er bekommt eine eigene Konversation, einen eigenen Modus und eigenen Tool-Zugriff. Der übergeordnete Agent delegiert einen bestimmten Auftrag, wartet auf das Ergebnis und fährt mit seiner eigenen Arbeit fort.

### Wann Sub-Agents helfen

- **Research-Fächer** -- Mehrere Themen parallel statt nacheinander durchsuchen
- **Aufteilen und erobern** -- Eine große Aufgabe in unabhängige Teile zerlegen
- **Modus-Isolation** -- Eine rein lesende Analyse im Ask-Modus ausführen, während der übergeordnete Agent im Agent-Modus arbeitet
- **Lange Aufgaben** -- Die Hauptkonversation fokussiert halten, während ein Sub-Agent eine Nebenaufgabe übernimmt

## So funktioniert `new_task`

Der Agent startet Sub-Agents über das `new_task`-Tool. Du rufst dieses Tool nicht direkt auf -- der Agent entscheidet selbst, wann Delegation sinnvoll ist.

### Was der Agent festlegt

| Parameter | Zweck |
|-----------|-------|
| **Mode** | In welchem Modus der untergeordnete Agent läuft (Ask oder Agent) |
| **Message** | Die konkrete Aufgabenbeschreibung für das Kind |
| **Context** | Relevante Informationen aus der übergeordneten Konversation |

### Tiefenbegrenzung

Sub-Agents können eigene Sub-Agents starten, aber Obsilo erzwingt eine maximale Tiefe von 2 Ebenen. Das verhindert unkontrollierte Ketten:

```
Haupt-Agent (Ebene 0)
  -> Sub-Agent A (Ebene 1)
      -> Sub-Agent A1 (Ebene 2) -- maximale Tiefe, kann nicht weiter starten
  -> Sub-Agent B (Ebene 1)
```

### Parallele Ausführung

Lese-sichere Tools (Suchen, Dateien lesen, Semantic Search) laufen parallel über `Promise.all`. Ein Sub-Agent, der drei Themen recherchiert, sucht also alle drei gleichzeitig -- nicht nacheinander.

:::tip Du musst das nicht steuern
Die Sub-Agent-Orchestrierung ist automatisch. Beschreibe einfach dein Ziel, und der Agent entscheidet, ob er delegiert. Beispiel: *"Recherchiere diese 5 Unternehmen und erstelle eine Vergleichstabelle"* -- der Agent könnte Sub-Agents für jedes Unternehmen starten.
:::

## Praktische Beispiele

### Research-Fächer

**Dein Prompt:** *"Vergleiche die Notiz-Methoden, die in meinen Notizen über Zettelkasten, PARA und Johnny Decimal beschrieben werden"*

**Was passiert:**
1. Der Haupt-Agent startet 3 Sub-Agents, einen für jedes System
2. Jeder Sub-Agent sucht und liest die relevanten Notizen
3. Die Ergebnisse fließen zurück zum übergeordneten Agent
4. Der übergeordnete Agent erstellt den Vergleich

### Aufteilen und erobern

**Dein Prompt:** *"Organisiere meinen Projects/-Ordner neu -- gruppiere Notizen nach Status (aktiv, abgeschlossen, pausiert) und erstelle eine Index-Notiz"*

**Was passiert:**
1. Ein Sub-Agent analysiert alle Notizen und klassifiziert sie nach Status
2. Der übergeordnete Agent erstellt die Ordnerstruktur und verschiebt Dateien
3. Ein letzter Sub-Agent generiert die Index-Notiz mit Links

## Task-Extraktion

Obsilo erkennt umsetzbare Aufgaben in Agent-Antworten. Wenn der Agent eine Liste mit unmarkierten Checkboxen (`- [ ]`) erstellt, erkennt der TaskExtractor sie automatisch.

### So funktioniert es

1. Der Agent antwortet mit Aufgaben in seiner Nachricht (z.B. ein Projektplan mit Action Items)
2. Obsilo erkennt die `- [ ]`-Einträge
3. Ein **TaskSelectionModal** erscheint, in dem du auswählst, welche Aufgaben gespeichert werden sollen
4. Ausgewählte Aufgaben werden zu einzelnen Notizen in deinem Vault

### Task-Notizen

Jede extrahierte Aufgabe wird zu einer Notiz mit strukturiertem Frontmatter:

```markdown
---
type: task
status: open
source: agent-conversation
created: 2026-03-31
---

# Q1-Budgetverteilung prüfen

Tatsächliche Ausgaben mit dem geplanten Budget pro Abteilung vergleichen.
Abweichungen über 10% hervorheben.
```

Das integriert sich in dein bestehendes Aufgabenmanagement -- Dataview-Abfragen, Kanban-Boards oder jedes Plugin, das Frontmatter liest.

:::info Nicht nur Agent-Aufgaben
Die Task-Extraktion funktioniert bei jeder Checkliste, die der Agent erstellt. Ob Projektplan, Follow-ups aus Besprechungsnotizen oder nächste Research-Schritte -- sobald der Agent `- [ ]`-Einträge schreibt, kannst du sie erfassen.
:::

## Tipps für Multi-Agent-Arbeit

1. **Ambitioniert sein.** Mehrstufige Anfragen wie "recherchiere, vergleiche und fasse zusammen" sind genau das, worin Sub-Agents glänzen.
2. **Scope angeben.** Nenne konkrete Ordner, Tags oder Dateinamen, damit Sub-Agents wissen, wo sie suchen sollen.
3. **Activity-Block prüfen.** Du kannst die Tool-Aufrufe jedes Sub-Agents in der Aktivitätsansicht des übergeordneten Agents sehen.
4. **Task-Extraktion nutzen.** Wenn der Agent dir einen Plan gibt, lass ihn Task-Notizen erstellen, damit nichts durchrutscht.
5. **Der Tiefenbegrenzung vertrauen.** Zwei Ebenen von Sub-Agents decken die meisten realen Szenarien ab. Wenn du mehr brauchst, teile die Arbeit in separate Konversationen auf.

:::warning Modellqualität zählt
Sub-Agents verbrauchen zusätzliche API-Aufrufe. Jeder untergeordnete Agent hat seine eigene Konversation mit dem Modell. Nutze ein leistungsfähiges Modell (Claude Sonnet oder besser) für komplexe Multi-Agent-Aufgaben -- kleinere Modelle haben oft Schwierigkeiten mit Delegationsentscheidungen.
:::

## Nächste Schritte

- [Skills, Regeln & Workflows](/de/guide/advanced/skills-rules-workflows) -- Erstelle Workflows, die Sub-Agents nutzen
- [Office-Dokumente](/de/guide/advanced/office-documents) -- Delegiere Dokumenterstellung an Sub-Agents
- [Connectors](/de/guide/advanced/connectors) -- Binde externe Tools für Sub-Agents an
