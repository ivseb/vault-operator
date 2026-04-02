---
title: Chat-Oberfläche
description: Anhänge, @-Erwähnung, Tool-Auswahl, Chat-Verlauf und Tastenkürzel.
---

# Chat-Oberfläche

Die Obsilo-Seitenleiste ist der Ort, an dem du mit dem Agent sprichst, Dateien anhängst, vergangene Gespräche durchsuchst und in Echtzeit beobachten kannst, was der Agent tut. Diese Seite erklärt jeden Teil der Oberfläche.

## Das Chat-Panel

Öffne Obsilo über das Icon in der linken Seitenleiste. Das Panel besteht aus drei Bereichen:

- **Toolbar** oben -- Mode-Auswahl, Modell-Auswahl und der Verlauf-Button
- **Nachrichtenbereich** in der Mitte -- dein Gespräch, Activity Blocks und Approval Cards
- **Eingabeleiste** unten -- Textfeld, Anhangs-Button und Sende-Button

## Nachrichten senden

Tippe deine Nachricht ein und drücke **Enter** zum Senden. Für mehrzeilige Nachrichten drücke **Shift+Enter**, um eine neue Zeile einzufügen.

:::tip Konfigurierbarer Sende-Shortcut
Unter **Settings > Obsilo Agent > Interface** kannst du den Sende-Shortcut auf **Ctrl+Enter** (bzw. **Cmd+Enter** auf dem Mac) ändern, falls du Enter lieber für Zeilenumbrüche nutzen möchtest.
:::

## Anhänge

Du kannst Dateien anhängen, um dem Agent zusätzlichen Kontext zu geben. Drei Wege zum Anhängen:

- **Drag and Drop** -- ziehe eine Datei vom Desktop oder Dateimanager auf die Chat-Eingabe
- **Aus der Zwischenablage einfügen** -- Screenshots und kopierte Bilder werden automatisch hinzugefügt
- **Klick auf das Büroklammer-Icon** neben dem Eingabefeld, um Dateien auszuwählen

### Unterstützte Dateitypen

| Typ | Beispiele | Hinweise |
|-----|-----------|----------|
| Bilder | PNG, JPG, GIF, WebP | Der Agent kann Bildinhalte sehen und beschreiben |
| Office-Dokumente | PPTX, DOCX, XLSX | Inhalte werden extrahiert und als Kontext hinzugefügt |
| PDF | Beliebige PDF-Dateien | Text wird extrahiert, damit der Agent ihn lesen kann |
| Textdateien | Markdown, TXT, CSV, JSON | Werden als Klartext-Kontext hinzugefügt |

:::warning 50 MB Limit
Jeder Anhang kann bis zu 50 MB groß sein. Sehr große Dateien können einen erheblichen Teil des Kontextfensters des Modells belegen, sodass weniger Platz für das Gespräch bleibt.
:::

## @-Erwähnung

Tippe **@** im Eingabefeld, um deinen Vault nach Dateinamen zu durchsuchen. Ein Dropdown erscheint während der Eingabe und zeigt passende Notizen an. Wähle eine Datei aus, um sie als Kontext anzuhängen.

Das ist der schnellste Weg, den Agent auf eine bestimmte Notiz zu verweisen, ohne den Chat zu verlassen.

**Beispiel:** *"Fasse @meeting-notes-march zusammen und vergleiche die Action Items mit @project-roadmap"*

## Workflow- und Prompt-Auswahl

Tippe **/** im Eingabefeld, um die Auswahl zu öffnen. Dort siehst du:

- **Workflows** -- mehrstufige Aufgabenvorlagen (z.B. ein Thema recherchieren, einen Ordner reorganisieren)
- **Support Prompts** -- vorgefertigte Prompts für gängige Aufgaben

Wähle einen Eintrag aus, um ihn in deine Nachricht einzufügen. Du kannst den Text vor dem Senden noch bearbeiten.

## Activity Blocks

Wenn der Agent arbeitet, erscheint ein **Activity Block** unterhalb seiner Antwort. Er zeigt jeden Tool Call in Echtzeit:

- Der **Tool-Name** und wichtige Parameter (z.B. welche Datei gelesen oder welche Suchanfrage verwendet wurde)
- Eine **Ergebnis-Vorschau** -- klicke zum Aufklappen für die vollständigen Details
- **Diff-Badges** bei Schreiboperationen, die hinzugefügte und entfernte Zeilen anzeigen (z.B. `+12 / -3`)

Activity Blocks werden standardmäßig eingeklappt, sobald der Agent fertig ist. Du kannst sie jederzeit aufklappen.

:::info Warum das wichtig ist
Activity Blocks geben dir volle Transparenz. Du kannst jederzeit genau sehen, was der Agent getan hat, welche Dateien er gelesen und was er geändert hat.
:::

## Approval Cards

Wenn der Agent eine Schreiboperation ausführen möchte (und Auto-Approve für diese Kategorie deaktiviert ist), erscheint eine **Approval Card**. Sie zeigt genau, was der Agent vorhat, und bietet dir drei Optionen:

- **Allow once** -- diese einzelne Aktion genehmigen
- **Always allow** -- diese Kategorie ab sofort automatisch genehmigen
- **Deny** -- die Aktion ablehnen

Details zu den Berechtigungskategorien findest du unter [Sicherheit & Kontrolle](/de/guide/working-with-obsilo/safety-control).

## Die Undo-Leiste

Nachdem der Agent eine Aufgabe abgeschlossen hat, bei der Dateien geändert wurden, erscheint eine **Undo-Leiste** am unteren Rand des Gesprächs. Klicke auf **Undo**, um alle Änderungen dieser Aufgabe rückgängig zu machen -- jede geänderte Datei wird aus ihrem Checkpoint wiederhergestellt.

Die Undo-Leiste bleibt sichtbar, bis du eine neue Nachricht sendest oder sie schließt.

## Chat-Verlauf

Obsilo speichert jedes Gespräch automatisch. So greifst du auf deinen Verlauf zu:

1. Klicke auf das **Verlauf-Icon** in der Toolbar (Uhr-Symbol)
2. Durchsuche vergangene Gespräche -- jedes zeigt einen Titel, ein Datum und eine Vorschau
3. Klicke auf ein Gespräch, um es **wiederherzustellen** und dort weiterzumachen, wo du aufgehört hast

Gespräche erhalten automatisch einen Titel basierend auf ihrem Inhalt. Du kannst verknüpfte Gespräche auch direkt aus deinen Notizen heraus finden -- siehe [Gedächtnis & Personalisierung](/de/guide/working-with-obsilo/memory-personalization) für Chat-Linking.

## Kontextanzeige und Condensation

Am oberen Rand des Nachrichtenbereichs zeigt ein kleiner Indikator an, wie viel des Kontextfensters des Modells aktuell belegt ist. Wenn Gespräche länger werden, kann Obsilo frühere Nachrichten **kondensieren**, um innerhalb der Grenzen zu bleiben. Dabei passiert Folgendes:

- Ein kurzer Hinweis erscheint im Gespräch
- Wichtige Fakten und Entscheidungen bleiben erhalten
- Ältere Tool Call Details werden ggf. zusammengefasst

Das geschieht automatisch und sorgt dafür, dass auch lange Gespräche reibungslos weiterlaufen.

## Tastenkürzel

| Tastenkürzel | Aktion |
|---------------|--------|
| `Enter` | Nachricht senden (konfigurierbar) |
| `Shift+Enter` | Neue Zeile in der Eingabe |
| `@` | Datei-Erwähnung öffnen |
| `/` | Workflow/Prompt-Auswahl öffnen |
| `Escape` | Auswahl schließen oder aktuelle Eingabe abbrechen |

## Tipps für ein besseres Chat-Erlebnis

1. **Hänge relevante Dateien an**, anstatt langen Text in die Nachricht zu kopieren. Anhänge werden effizienter verarbeitet.
2. **Nutze @-Erwähnung**, wenn du weißt, welche Notiz du brauchst. Das ist schneller und präziser, als den Agent suchen zu lassen.
3. **Prüfe die Activity Blocks**, nachdem der Agent gearbeitet hat. Sie helfen dir zu lernen, welche Tools verfügbar sind und wie der Agent Aufgaben angeht.
4. **Starte ein neues Gespräch** für zusammenhanglose Themen. Das hält den Kontext fokussiert und vermeidet Condensation.

## Nächste Schritte

- [Vault-Operationen](/de/guide/working-with-obsilo/vault-operations) -- Was der Agent mit deinen Dateien tun kann
- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche für bessere Ergebnisse einrichten
- [Sicherheit & Kontrolle](/de/guide/working-with-obsilo/safety-control) -- Berechtigungen, Checkpoints und das Audit-Log
