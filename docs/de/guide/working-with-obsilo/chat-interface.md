---
title: Chat-Oberflaeche
description: Anhaenge, @-Erwaehnung, Tool-Auswahl, Chat-Verlauf und Tastenkuerzel.
---

# Chat-Oberflaeche

Die Obsilo-Seitenleiste ist der Ort, an dem du mit dem Agent sprichst, Dateien anhaengst, vergangene Gespraeche durchsuchst und in Echtzeit beobachten kannst, was der Agent tut. Diese Seite erklaert jeden Teil der Oberflaeche.

## Das Chat-Panel

Oeffne Obsilo ueber das Icon in der linken Seitenleiste. Das Panel besteht aus drei Bereichen:

- **Toolbar** oben -- Mode-Auswahl, Modell-Auswahl und der Verlauf-Button
- **Nachrichtenbereich** in der Mitte -- dein Gespraech, Activity Blocks und Approval Cards
- **Eingabeleiste** unten -- Textfeld, Anhangs-Button und Sende-Button

## Nachrichten senden

Tippe deine Nachricht ein und druecke **Enter** zum Senden. Fuer mehrzeilige Nachrichten druecke **Shift+Enter**, um eine neue Zeile einzufuegen.

:::tip Konfigurierbarer Sende-Shortcut
Unter **Settings > Obsilo Agent > Interface** kannst du den Sende-Shortcut auf **Ctrl+Enter** (bzw. **Cmd+Enter** auf dem Mac) aendern, falls du Enter lieber fuer Zeilenumbrueche nutzen moechtest.
:::

## Anhaenge

Du kannst Dateien anhaengen, um dem Agent zusaetzlichen Kontext zu geben. Drei Wege zum Anhaengen:

- **Drag and Drop** -- ziehe eine Datei vom Desktop oder Dateimanager auf die Chat-Eingabe
- **Aus der Zwischenablage einfuegen** -- Screenshots und kopierte Bilder werden automatisch hinzugefuegt
- **Klick auf das Bueroklammer-Icon** neben dem Eingabefeld, um Dateien auszuwaehlen

### Unterstuetzte Dateitypen

| Typ | Beispiele | Hinweise |
|-----|-----------|----------|
| Bilder | PNG, JPG, GIF, WebP | Der Agent kann Bildinhalte sehen und beschreiben |
| Office-Dokumente | PPTX, DOCX, XLSX | Inhalte werden extrahiert und als Kontext hinzugefuegt |
| PDF | Beliebige PDF-Dateien | Text wird extrahiert, damit der Agent ihn lesen kann |
| Textdateien | Markdown, TXT, CSV, JSON | Werden als Klartext-Kontext hinzugefuegt |

:::warning 50 MB Limit
Jeder Anhang kann bis zu 50 MB gross sein. Sehr grosse Dateien koennen einen erheblichen Teil des Kontextfensters des Modells belegen, sodass weniger Platz fuer das Gespraech bleibt.
:::

## @-Erwaehnung

Tippe **@** im Eingabefeld, um deinen Vault nach Dateinamen zu durchsuchen. Ein Dropdown erscheint waehrend der Eingabe und zeigt passende Notizen an. Waehle eine Datei aus, um sie als Kontext anzuhaengen.

Das ist der schnellste Weg, den Agent auf eine bestimmte Notiz zu verweisen, ohne den Chat zu verlassen.

**Beispiel:** *"Fasse @meeting-notes-march zusammen und vergleiche die Action Items mit @project-roadmap"*

## Workflow- und Prompt-Auswahl

Tippe **/** im Eingabefeld, um die Auswahl zu oeffnen. Dort siehst du:

- **Workflows** -- mehrstufige Aufgabenvorlagen (z.B. ein Thema recherchieren, einen Ordner reorganisieren)
- **Support Prompts** -- vorgefertigte Prompts fuer gaengige Aufgaben

Waehle einen Eintrag aus, um ihn in deine Nachricht einzufuegen. Du kannst den Text vor dem Senden noch bearbeiten.

## Activity Blocks

Wenn der Agent arbeitet, erscheint ein **Activity Block** unterhalb seiner Antwort. Er zeigt jeden Tool Call in Echtzeit:

- Der **Tool-Name** und wichtige Parameter (z.B. welche Datei gelesen oder welche Suchanfrage verwendet wurde)
- Eine **Ergebnis-Vorschau** -- klicke zum Aufklappen fuer die vollstaendigen Details
- **Diff-Badges** bei Schreiboperationen, die hinzugefuegte und entfernte Zeilen anzeigen (z.B. `+12 / -3`)

Activity Blocks werden standardmaessig eingeklappt, sobald der Agent fertig ist. Du kannst sie jederzeit aufklappen.

:::info Warum das wichtig ist
Activity Blocks geben dir volle Transparenz. Du kannst jederzeit genau sehen, was der Agent getan hat, welche Dateien er gelesen und was er geaendert hat.
:::

## Approval Cards

Wenn der Agent eine Schreiboperation ausfuehren moechte (und Auto-Approve fuer diese Kategorie deaktiviert ist), erscheint eine **Approval Card**. Sie zeigt genau, was der Agent vorhat, und bietet dir drei Optionen:

- **Allow once** -- diese einzelne Aktion genehmigen
- **Always allow** -- diese Kategorie ab sofort automatisch genehmigen
- **Deny** -- die Aktion ablehnen

Details zu den Berechtigungskategorien findest du unter [Sicherheit & Kontrolle](/de/guide/working-with-obsilo/safety-control).

## Die Undo-Leiste

Nachdem der Agent eine Aufgabe abgeschlossen hat, bei der Dateien geaendert wurden, erscheint eine **Undo-Leiste** am unteren Rand des Gespraechs. Klicke auf **Undo**, um alle Aenderungen dieser Aufgabe rueckgaengig zu machen -- jede geaenderte Datei wird aus ihrem Checkpoint wiederhergestellt.

Die Undo-Leiste bleibt sichtbar, bis du eine neue Nachricht sendest oder sie schliesst.

## Chat-Verlauf

Obsilo speichert jedes Gespraech automatisch. So greifst du auf deinen Verlauf zu:

1. Klicke auf das **Verlauf-Icon** in der Toolbar (Uhr-Symbol)
2. Durchsuche vergangene Gespraeche -- jedes zeigt einen Titel, ein Datum und eine Vorschau
3. Klicke auf ein Gespraech, um es **wiederherzustellen** und dort weiterzumachen, wo du aufgehoert hast

Gespraeche erhalten automatisch einen Titel basierend auf ihrem Inhalt. Du kannst verknuepfte Gespraeche auch direkt aus deinen Notizen heraus finden -- siehe [Gedaechtnis & Personalisierung](/de/guide/working-with-obsilo/memory-personalization) fuer Chat-Linking.

## Kontextanzeige und Condensation

Am oberen Rand des Nachrichtenbereichs zeigt ein kleiner Indikator an, wie viel des Kontextfensters des Modells aktuell belegt ist. Wenn Gespraeche laenger werden, kann Obsilo fruehere Nachrichten **kondensieren**, um innerhalb der Grenzen zu bleiben. Dabei passiert Folgendes:

- Ein kurzer Hinweis erscheint im Gespraech
- Wichtige Fakten und Entscheidungen bleiben erhalten
- Aeltere Tool Call Details werden ggf. zusammengefasst

Das geschieht automatisch und sorgt dafuer, dass auch lange Gespraeche reibungslos weiterlaufen.

## Tastenkuerzel

| Tastenkuerzel | Aktion |
|---------------|--------|
| `Enter` | Nachricht senden (konfigurierbar) |
| `Shift+Enter` | Neue Zeile in der Eingabe |
| `@` | Datei-Erwaehnung oeffnen |
| `/` | Workflow/Prompt-Auswahl oeffnen |
| `Escape` | Auswahl schliessen oder aktuelle Eingabe abbrechen |

## Tipps fuer ein besseres Chat-Erlebnis

1. **Haenge relevante Dateien an**, anstatt langen Text in die Nachricht zu kopieren. Anhaenge werden effizienter verarbeitet.
2. **Nutze @-Erwaehnung**, wenn du weisst, welche Notiz du brauchst. Das ist schneller und praeziser, als den Agent suchen zu lassen.
3. **Pruefe die Activity Blocks**, nachdem der Agent gearbeitet hat. Sie helfen dir zu lernen, welche Tools verfuegbar sind und wie der Agent Aufgaben angeht.
4. **Starte ein neues Gespraech** fuer unzusammenhaengende Themen. Das haelt den Kontext fokussiert und vermeidet Condensation.

## Naechste Schritte

- [Vault-Operationen](/de/guide/working-with-obsilo/vault-operations) -- Was der Agent mit deinen Dateien tun kann
- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche fuer bessere Ergebnisse einrichten
- [Sicherheit & Kontrolle](/de/guide/working-with-obsilo/safety-control) -- Berechtigungen, Checkpoints und das Audit-Log
