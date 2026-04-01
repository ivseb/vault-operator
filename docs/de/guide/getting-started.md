---
title: Installation & Schnellstart
description: Obsilo installieren und in unter 3 Minuten das erste Gespräch starten.
---

# Installation & Schnellstart

Obsilo läuft in unter 3 Minuten in deinem Obsidian Vault.

## Plugin installieren

1. Öffne **Obsidian Einstellungen** > **Community Plugins** > **Durchsuchen**
2. Suche nach **"Obsilo Agent"**
3. Klicke auf **Installieren**, dann auf **Aktivieren**

Das Obsilo-Icon erscheint in der linken Seitenleiste.

:::tip BRAT (Beta-Tests)
Für die neueste Beta-Version kannst du Obsilo über [BRAT](https://github.com/TfTHacker/obsidian42-brat) installieren: Füge `pssah4/obsilo` als Beta-Plugin hinzu.
:::

## Erstes Modell einrichten

Obsilo braucht ein AI-Modell. Öffne **Einstellungen > Obsilo Agent > Models** und klicke auf **"+ add model"**.

### Kostenlose Option (ohne Kreditkarte)

1. Gehe zu [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Melde dich an und klicke auf **"Create API Key"**
3. Kopiere den Key und füge ihn in Obsilo ein

Google Gemini bietet leistungsstarke Modelle kostenlos mit großzügigen Rate Limits.

### Beste Qualität

| Provider | Modell | Stärken |
|----------|--------|---------|
| Anthropic | Claude Sonnet 4.6 | Beste Gesamtqualität, exzellenter Tool-Einsatz |
| OpenAI | GPT-4o | Schnell, gut bei strukturiertem Output |
| Google | Gemini 2.5 Pro | Kostenlos nutzbar, großes Context Window |

### Lokal & privat

Für maximale Privatsphäre kannst du ein Modell lokal betreiben -- keine Daten verlassen deinen Rechner:

- **Ollama**: Installiere von [ollama.ai](https://ollama.ai), dann `ollama pull llama3.2`
- **LM Studio**: Lade es von [lmstudio.ai](https://lmstudio.ai) herunter, installiere ein Modell und starte den Server

:::info Kein Lock-In
Obsilo unterstützt über 10 Provider. Du kannst das Modell jederzeit wechseln, sogar mitten im Gespräch. Konfiguriere mehrere Modelle und wähle für jede Aufgabe das passende.
:::

## Dein erster Chat

1. Klicke auf das **Obsilo-Icon** in der linken Seitenleiste
2. Tippe eine Nachricht und drücke **Enter**
3. Schau dem Agent bei der Arbeit zu -- er zeigt jeden Tool-Aufruf in Echtzeit

### Probier diese Prompts

- *"Welche Notizen habe ich zum Thema [beliebiges Thema]?"*
- *"Fasse die Notiz zusammen, die ich gerade geöffnet habe"*
- *"Erstelle eine neue Notiz mit einer Zusammenfassung meiner letzten 3 Daily Notes"*
- *"Finde alle Notizen mit dem Tag #projekt und erstelle ein Canvas mit ihren Verbindungen"*

## Was im Hintergrund passiert

Wenn du eine Nachricht sendest, macht Obsilo folgendes:

1. **Liest deine Nachricht** und entscheidet, welche Tools nötig sind
2. **Ruft Tools auf** (Dateien lesen, suchen, schreiben) -- du siehst jeden Aufruf im Activity Block
3. **Fragt um Erlaubnis** vor jeder Schreiboperation (sofern Auto-Approve nicht aktiviert ist)
4. **Gibt eine Antwort** mit dem Ergebnis zurück

Jede Schreiboperation erzeugt einen **Checkpoint** -- du kannst jede Änderung mit einem Klick rückgängig machen.

## Nächste Schritte

- [Dein erstes Gespräch](/de/guide/first-conversation) -- Lerne Modes, Kontext und wie der Agent denkt
- [Modell auswählen](/de/guide/choosing-a-model) -- Finde das beste Modell für deinen Workflow
- [Sicherheit & Kontrolle](/de/guide/working-with-obsilo/safety-control) -- Genehmigungen und Checkpoints verstehen
