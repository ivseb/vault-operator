---
title: Sicherheit & Kontrolle
description: Berechtigungen, Checkpoints, Genehmigungen und das Audit-Log -- so behältst du die Kontrolle über Obsilo.
---

# Sicherheit & Kontrolle

Obsilo basiert auf einem Prinzip: **Nichts in deinem Vault ändert sich ohne dein Wissen.** Diese Seite erklärt die Sicherheitsmechanismen und wie du sie nach deinem Komfortniveau konfigurierst.

## Das Genehmigungssystem

Standardmäßig verfolgt Obsilo einen **Fail-Closed-Ansatz** -- es muss fragen, bevor es eine Aktion ausführt, die deinen Vault verändert. Jedes Schreiben, Bearbeiten, Löschen oder jeden externen Aufruf löst eine Approval Card im Chat aus.

### Was eine Approval Card zeigt

Wenn Obsilo etwas tun möchte, erscheint eine Karte mit:

- **Datei schreiben** -- der vollständige Inhalt, der geschrieben wird
- **Datei bearbeiten** -- ein Diff, das genau zeigt, was sich ändert (hinzugefügte und entfernte Zeilen)
- **Datei löschen** -- welche Datei entfernt wird
- **Verschieben/Umbenennen** -- Quell- und Zielpfade

Du kannst **Allow once** (diese spezifische Aktion genehmigen) oder **Always allow** (diese Kategorie ab sofort automatisch genehmigen) wählen.

## Berechtigungskategorien

Du kannst Auto-Approve für einzelne Kategorien aktivieren. Gehe zu **Settings > Obsilo Agent > Permissions** für die vollständige Liste:

| Kategorie | Was sie abdeckt | Risikostufe |
|-----------|----------------|-------------|
| **Read Operations** | Dateien lesen, Ordner auflisten, Suchen | Niedrig -- nichts ändert sich |
| **Note Edits** | Bearbeitung bestehender Markdown-Notizen | Mittel -- ändert deine Inhalte |
| **Vault Changes** | Erstellen, Verschieben oder Löschen von Dateien und Ordnern | Mittel-Hoch -- strukturelle Änderungen |
| **Web Operations** | Webseiten abrufen, im Internet suchen | Niedrig-Mittel -- externer Datenzugriff |
| **MCP Calls** | Externe Tools über das Model Context Protocol aufrufen | Mittel -- abhängig vom Tool |
| **Subtasks** | Hintergrund-Sub-Agents starten | Niedrig -- erbt Eltern-Berechtigungen |
| **Plugin Skills** | Integrierte Skill-Workflows ausführen | Niedrig -- geführte mehrstufige Aufgaben |
| **Plugin API Reads** | Daten von Obsidian-Plugins lesen | Niedrig -- nur lesend |
| **Plugin API Writes** | Einstellungen von Obsidian-Plugins ändern | Hoch -- kann App-Verhalten ändern |
| **Recipes** | Mehrstufige automatisierte Workflows ausführen | Hoch -- viele Aktionen hintereinander |
| **Sandbox** | Code in der isolierten Sandbox ausführen | Hoch -- führt generierten Code aus |

:::warning Warnung zum permissiven Modus
Wenn du Auto-Approve sowohl für **Web Operations** als auch für **Note Edits** (oder Vault Changes) aktivierst, zeigt Obsilo eine Sicherheitswarnung. Diese Kombination bedeutet, dass der Agent Inhalte aus dem Internet abrufen und ohne Nachfrage in deinen Vault schreiben könnte -- ein Muster, das das Risiko erhöht.
:::

## Änderungen überprüfen

### Die Approval Card

Vor jeder Schreiboperation erscheint eine Approval Card direkt im Chat. Bei Dateibearbeitungen zeigt sie ein farbkodiertes Diff mit einem Badge wie `+3 / -1`, das hinzugefügte und entfernte Zeilen angibt. Lies das Diff sorgfältig, bevor du genehmigst.

### Das Diff-Review-Modal

Nach Abschluss einer Aufgabe kannst du alle Änderungen auf einmal überprüfen:

1. Die **Undo-Leiste** erscheint unterhalb der letzten Nachricht
2. Klicke auf **"Review changes"**, um das Diff-Review-Modal zu öffnen
3. Für jede Datei siehst du alle Änderungen, gruppiert nach Abschnitt (Überschriften, Absätze, Codeblöcke)
4. Entscheide pro Abschnitt: **Keep**, **Undo** oder **Edit** (die Änderung manuell anpassen)

Das gibt dir feinkörnige Kontrolle -- du kannst den Großteil der Arbeit einer Aufgabe behalten und gleichzeitig einen bestimmten Absatz zurücksetzen.

## Checkpoints und Undo

Obsilo erstellt einen **Checkpoint** vor der ersten Änderung an einer Datei innerhalb einer Aufgabe. Checkpoints werden in einem Shadow Repository gespeichert (mittels isomorphic-git), das deine eigene Git-Historie nicht beeinflusst.

### Die Undo-Leiste

Nach jeder Aufgabe, die Dateien verändert hat, erscheint eine Undo-Leiste:

- **"Undo all changes"** -- stellt jede Datei mit einem Klick in den Zustand vor der Aufgabe zurück
- **"Review changes"** -- öffnet das Diff-Review-Modal für dateibezogene Entscheidungen

:::tip Undo ist immer verfügbar
Auch wenn du alles automatisch genehmigst, zeichnet das Checkpoint-System den Zustand vor Änderungen auf. Du kannst immer im Nachhinein rückgängig machen.
:::

### Wie Checkpoints funktionieren

1. Obsilo erstellt einen Snapshot jeder Datei vor ihrer ersten Änderung in einer Aufgabe
2. Der Snapshot wird als Git-Commit im Shadow Repository gespeichert
3. Beim Undo wird der Originalinhalt aus dem Snapshot wiederhergestellt
4. Dateien, die neu erstellt wurden (vor der Aufgabe nicht existierten), werden beim Undo gelöscht

Checkpoints sind automatisch -- du musst nichts konfigurieren.

## Das Operations-Log

Jeder Tool Call wird in einer täglichen Audit-Log-Datei aufgezeichnet. Das ist dein Nachweis über alles, was Obsilo tut.

**Was protokolliert wird:**
- Zeitstempel
- Tool-Name und Parameter (sensible Werte wie API-Keys werden automatisch geschwärzt)
- Ob es erfolgreich war oder fehlgeschlagen ist
- Wie lange es gedauert hat

**Wo du es findest:** Die Logs werden als JSONL-Dateien (eine pro Tag) im Plugin-Verzeichnis unter `logs/` gespeichert. Jede Datei ist nach Datum benannt, zum Beispiel `2026-03-31.jsonl`.

**Aufbewahrung:** Logs werden **30 Tage** aufbewahrt und dann automatisch gelöscht. Du kannst aktuelle Logs unter **Settings > Obsilo Agent > Log** durchsuchen.

:::info Das Log speichert nie Dateiinhalte
Aus Datenschutzgründen protokolliert das Operations-Log, dass eine Datei gelesen oder geschrieben wurde, aber nicht den vollständigen Inhalt. Es loggt den Dateipfad und die Inhaltslänge, nicht den eigentlichen Text.
:::

## Die Ignore-Datei

Erstelle eine Datei namens `.obsidian-agentignore` im Wurzelverzeichnis deines Vaults, um Pfade zu definieren, auf die der Agent nie zugreifen soll. Sie verwendet die gleiche Syntax wie `.gitignore`:

```
# Privates Tagebuch -- Agent kann diese nicht lesen oder ändern
journal/
diary-*.md

# Zugangsdaten und sensible Dateien
secrets/
*.env
```

Es gibt auch `.obsidian-agentprotected` für Dateien, die der Agent **lesen**, aber nie **schreiben** darf:

```
# Templates -- Agent kann sie referenzieren, aber nicht ändern
templates/
```

Beide Dateien sind selbst geschützt -- der Agent kann sie nicht ändern oder löschen.

:::tip Immer blockierte Pfade
Unabhängig von deiner Konfiguration greift Obsilo nie auf `.git/`, den Obsidian-Workspace-Cache oder interne Konfigurationsdateien zu. Diese sind standardmäßig blockiert.
:::

## Best Practices für Sicherheit

1. **Starte mit aktivierten Genehmigungen.** Lass Auto-Approve deaktiviert, bis du mit der Arbeitsweise von Obsilo vertraut bist. Beobachte die Approval Cards, um zu lernen, was der Agent tut.

2. **Aktiviere Kategorien schrittweise.** Beginne damit, Lesezugriffe automatisch zu genehmigen (niedriges Risiko), dann Notizbearbeitungen, wenn du dem Urteil des Agents vertraust. Behalte Vault-Änderungen und Sandbox länger auf manueller Genehmigung.

3. **Vermeide die permissive Kombination.** Genehmige nicht gleichzeitig Web-Operationen und Schreibzugriffe automatisch, es sei denn, du vertraust den Inhaltsquellen vollständig.

4. **Nutze die Ignore-Datei.** Wenn du sensible Notizen hast (Finanzdaten, medizinische Informationen, private Tagebücher), füge sie zu `.obsidian-agentignore` hinzu, bevor du dem Agent weitreichende Berechtigungen gibst.

5. **Prüfe das Operations-Log regelmäßig.** Ein kurzer Blick in die aktuellen Logs hilft dir zu verstehen, was der Agent getan hat, und Unerwartetes zu erkennen.

6. **Sichere deinen Vault.** Checkpoints bieten Undo innerhalb von Obsilo, aber ein ordentliches Vault-Backup (Obsidian Sync, Git oder Dateisystem-Backup) schützt vor allem.

7. **Nutze den Ask-Mode zum Erkunden.** Wenn du nur Antworten willst, ohne Änderungen, wechsle in den Ask-Mode. Er ist von Natur aus schreibgeschützt -- nichts in deinem Vault kann verändert werden.
