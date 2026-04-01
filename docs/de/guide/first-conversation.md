---
title: Dein erstes Gespräch
description: Die Grundlagen im Umgang mit Obsilo -- Modes, Kontext und wie der Agent denkt.
---

# Dein erstes Gespräch

Obsilo ist kein einfacher Chatbot. Es ist ein Agent, der deinen Vault lesen, durchsuchen und bearbeiten kann. Ein paar Grundkonzepte machen den Umgang deutlich besser.

## Modes

Obsilo hat zwei eingebaute Modes:

| Mode | Was er tut | Wann verwenden |
|------|-----------|----------------|
| **Ask** | Nur Lesen. Sucht und analysiert, ändert aber nichts am Vault. | Fragen, Recherche, Analyse |
| **Agent** | Voller Zugriff. Kann Dateien lesen, schreiben, bearbeiten, erstellen und löschen. | Aktive Arbeit, Inhalte erstellen, Umstrukturierung |

Wechsle den Mode über das Dropdown in der Chat-Toolbar, oder lass den Agent automatisch wechseln.

:::tip Starte mit Ask Mode
Wenn du Obsilo zum ersten Mal nutzt, beginne im **Ask** Mode. Er kann nichts verändern, du kannst also in Ruhe alles erkunden. Wechsle zu **Agent** Mode, wenn du den Agent arbeiten lassen willst.
:::

## Kontext -- Was der Agent weiß

Der Agent sieht:
- **Deine Nachricht** und den bisherigen Gesprächsverlauf
- **Die aktive Notiz** (wenn "auto-add active file" in den Einstellungen aktiviert ist)
- **Angehängte Dateien** (per Drag & Drop oder über das Büroklammer-Icon)
- **@-erwähnte Dateien** (tippe `@` im Chat, um deinen Vault zu durchsuchen)
- **Sein Gedächtnis** aus früheren Gesprächen (wenn Memory aktiviert ist)

Der Agent liest **nicht** deinen gesamten Vault im Voraus. Er sucht und liest Dateien bei Bedarf, über seine Tools.

## Der Activity Block

Wenn der Agent arbeitet, erscheint ein aufklappbarer **Activity Block** unter der Antwort. Er zeigt jeden Tool-Aufruf in Echtzeit:

- **Tool-Name** (z.B. `read_file`, `search_files`, `semantic_search`)
- **Wichtige Parameter** (z.B. Dateipfad oder Suchanfrage)
- **Ergebnis** (aufklappen für Details)
- **Diff Badge** bei Schreiboperationen: `+3 / -1` geänderte Zeilen

Klicke auf den Activity Block, um ihn jederzeit auf- oder zuzuklappen.

## Genehmigungen

Standardmäßig **fragt der Agent um Erlaubnis**, bevor er etwas schreibt. Es erscheint eine Genehmigungskarte, die genau zeigt, was der Agent tun möchte:

- **Datei schreiben** -- zeigt den vollständigen Inhalt
- **Datei bearbeiten** -- zeigt den Diff (was sich ändert)
- **Datei löschen** -- zeigt welche Datei
- **Datei verschieben** -- zeigt Quelle und Ziel

Klicke auf **"Allow once"**, um einmalig zu genehmigen, oder auf **"Always allow"**, um diese Kategorie dauerhaft freizugeben.

:::warning Auto-Approve mit Bedacht
Wenn du Auto-Approve für Schreibzugriffe aktivierst, handelt der Agent ohne Rückfrage. Das Checkpoint-System erlaubt zwar Rückgängigmachen, aber prüfe nach jeder Aufgabe, was sich geändert hat.
:::

## Tastenkürzel

| Kürzel | Aktion |
|--------|--------|
| `Enter` | Nachricht senden (konfigurierbar: Ctrl/Cmd+Enter) |
| `Shift+Enter` | Neue Zeile |
| `/` | Workflow-/Prompt-Auswahl öffnen |
| `@` | Datei-Erwähnung öffnen |

## Tipps für bessere Ergebnisse

1. **Sei konkret.** "Fasse die Meeting-Notizen vom März zusammen" funktioniert besser als "fasse meine Notizen zusammen."
2. **Erwähne Dateien.** Nutze `@Dateiname`, um den Agent auf bestimmte Notizen hinzuweisen.
3. **Nutze die Modes.** Ask Mode für Fragen, Agent Mode für Aktionen.
4. **Prüfe die Activity.** Der Activity Block zeigt dir genau, was der Agent getan hat -- ideal um zu lernen, wie er arbeitet.
5. **Lass ihn suchen.** Der Agent kann deinen Vault semantisch durchsuchen. Stell breite Fragen wie "Was weiß ich über X?" und lass die semantische Suche die relevanten Notizen finden.

## Nächste Schritte

- [Modell auswählen](/de/guide/choosing-a-model) -- Provider-Vergleich und Empfehlungen
- [Chat Interface](/de/guide/working-with-obsilo/chat-interface) -- Alle Chat-Funktionen im Detail
- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche einrichten
