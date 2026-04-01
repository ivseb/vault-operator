---
title: Sicherheit & Kontrolle
description: Berechtigungen, Checkpoints, Genehmigungen und das Audit-Log -- so behaeltst du die Kontrolle ueber Obsilo.
---

# Sicherheit & Kontrolle

Obsilo basiert auf einem Prinzip: **Nichts in deinem Vault aendert sich ohne dein Wissen.** Diese Seite erklaert die Sicherheitsmechanismen und wie du sie nach deinem Komfortniveau konfigurierst.

## Das Genehmigungssystem

Standardmaessig verfolgt Obsilo einen **Fail-Closed-Ansatz** -- es muss fragen, bevor es eine Aktion ausfuehrt, die deinen Vault veraendert. Jedes Schreiben, Bearbeiten, Loeschen oder jeden externen Aufruf loest eine Approval Card im Chat aus.

### Was eine Approval Card zeigt

Wenn Obsilo etwas tun moechte, erscheint eine Karte mit:

- **Datei schreiben** -- der vollstaendige Inhalt, der geschrieben wird
- **Datei bearbeiten** -- ein Diff, das genau zeigt, was sich aendert (hinzugefuegte und entfernte Zeilen)
- **Datei loeschen** -- welche Datei entfernt wird
- **Verschieben/Umbenennen** -- Quell- und Zielpfade

Du kannst **Allow once** (diese spezifische Aktion genehmigen) oder **Always allow** (diese Kategorie ab sofort automatisch genehmigen) waehlen.

## Berechtigungskategorien

Du kannst Auto-Approve fuer einzelne Kategorien aktivieren. Gehe zu **Settings > Obsilo Agent > Permissions** fuer die vollstaendige Liste:

| Kategorie | Was sie abdeckt | Risikostufe |
|-----------|----------------|-------------|
| **Read Operations** | Dateien lesen, Ordner auflisten, Suchen | Niedrig -- nichts aendert sich |
| **Note Edits** | Bearbeitung bestehender Markdown-Notizen | Mittel -- aendert deine Inhalte |
| **Vault Changes** | Erstellen, Verschieben oder Loeschen von Dateien und Ordnern | Mittel-Hoch -- strukturelle Aenderungen |
| **Web Operations** | Webseiten abrufen, im Internet suchen | Niedrig-Mittel -- externer Datenzugriff |
| **MCP Calls** | Externe Tools ueber das Model Context Protocol aufrufen | Mittel -- abhaengig vom Tool |
| **Subtasks** | Hintergrund-Sub-Agents starten | Niedrig -- erbt Eltern-Berechtigungen |
| **Plugin Skills** | Integrierte Skill-Workflows ausfuehren | Niedrig -- gefuehrte mehrstufige Aufgaben |
| **Plugin API Reads** | Daten von Obsidian-Plugins lesen | Niedrig -- nur lesend |
| **Plugin API Writes** | Einstellungen von Obsidian-Plugins aendern | Hoch -- kann App-Verhalten aendern |
| **Recipes** | Mehrstufige automatisierte Workflows ausfuehren | Hoch -- viele Aktionen hintereinander |
| **Sandbox** | Code in der isolierten Sandbox ausfuehren | Hoch -- fuehrt generierten Code aus |

:::warning Warnung zum permissiven Modus
Wenn du Auto-Approve sowohl fuer **Web Operations** als auch fuer **Note Edits** (oder Vault Changes) aktivierst, zeigt Obsilo eine Sicherheitswarnung. Diese Kombination bedeutet, dass der Agent Inhalte aus dem Internet abrufen und ohne Nachfrage in deinen Vault schreiben koennte -- ein Muster, das das Risiko erhoeht.
:::

## Aenderungen ueberpruefen

### Die Approval Card

Vor jeder Schreiboperation erscheint eine Approval Card direkt im Chat. Bei Dateibearbeitungen zeigt sie ein farbkodiertes Diff mit einem Badge wie `+3 / -1`, das hinzugefuegte und entfernte Zeilen angibt. Lies das Diff sorgfaeltig, bevor du genehmigst.

### Das Diff-Review-Modal

Nach Abschluss einer Aufgabe kannst du alle Aenderungen auf einmal ueberpruefen:

1. Die **Undo-Leiste** erscheint unterhalb der letzten Nachricht
2. Klicke auf **"Review changes"**, um das Diff-Review-Modal zu oeffnen
3. Fuer jede Datei siehst du alle Aenderungen, gruppiert nach Abschnitt (Ueberschriften, Absaetze, Codebloecke)
4. Entscheide pro Abschnitt: **Keep**, **Undo** oder **Edit** (die Aenderung manuell anpassen)

Das gibt dir feinkoernige Kontrolle -- du kannst den Grossteil der Arbeit einer Aufgabe behalten und gleichzeitig einen bestimmten Absatz zuruecksetzen.

## Checkpoints und Undo

Obsilo erstellt einen **Checkpoint** vor der ersten Aenderung an einer Datei innerhalb einer Aufgabe. Checkpoints werden in einem Shadow Repository gespeichert (mittels isomorphic-git), das deine eigene Git-Historie nicht beeinflusst.

### Die Undo-Leiste

Nach jeder Aufgabe, die Dateien veraendert hat, erscheint eine Undo-Leiste:

- **"Undo all changes"** -- stellt jede Datei mit einem Klick in den Zustand vor der Aufgabe zurueck
- **"Review changes"** -- oeffnet das Diff-Review-Modal fuer dateibezogene Entscheidungen

:::tip Undo ist immer verfuegbar
Auch wenn du alles automatisch genehmigst, zeichnet das Checkpoint-System den Zustand vor Aenderungen auf. Du kannst immer im Nachhinein rueckgaengig machen.
:::

### Wie Checkpoints funktionieren

1. Obsilo erstellt einen Snapshot jeder Datei vor ihrer ersten Aenderung in einer Aufgabe
2. Der Snapshot wird als Git-Commit im Shadow Repository gespeichert
3. Beim Undo wird der Originalinhalt aus dem Snapshot wiederhergestellt
4. Dateien, die neu erstellt wurden (vor der Aufgabe nicht existierten), werden beim Undo geloescht

Checkpoints sind automatisch -- du musst nichts konfigurieren.

## Das Operations-Log

Jeder Tool Call wird in einer taeglichen Audit-Log-Datei aufgezeichnet. Das ist dein Nachweis ueber alles, was Obsilo tut.

**Was protokolliert wird:**
- Zeitstempel
- Tool-Name und Parameter (sensible Werte wie API-Keys werden automatisch geschwärzt)
- Ob es erfolgreich war oder fehlgeschlagen ist
- Wie lange es gedauert hat

**Wo du es findest:** Die Logs werden als JSONL-Dateien (eine pro Tag) im Plugin-Verzeichnis unter `logs/` gespeichert. Jede Datei ist nach Datum benannt, zum Beispiel `2026-03-31.jsonl`.

**Aufbewahrung:** Logs werden **30 Tage** aufbewahrt und dann automatisch geloescht. Du kannst aktuelle Logs unter **Settings > Obsilo Agent > Log** durchsuchen.

:::info Das Log speichert nie Dateiinhalte
Aus Datenschutzgruenden protokolliert das Operations-Log, dass eine Datei gelesen oder geschrieben wurde, aber nicht den vollstaendigen Inhalt. Es loggt den Dateipfad und die Inhaltslaenge, nicht den eigentlichen Text.
:::

## Die Ignore-Datei

Erstelle eine Datei namens `.obsidian-agentignore` im Wurzelverzeichnis deines Vaults, um Pfade zu definieren, auf die der Agent nie zugreifen soll. Sie verwendet die gleiche Syntax wie `.gitignore`:

```
# Privates Tagebuch -- Agent kann diese nicht lesen oder aendern
journal/
diary-*.md

# Zugangsdaten und sensible Dateien
secrets/
*.env
```

Es gibt auch `.obsidian-agentprotected` fuer Dateien, die der Agent **lesen**, aber nie **schreiben** darf:

```
# Templates -- Agent kann sie referenzieren, aber nicht aendern
templates/
```

Beide Dateien sind selbst geschuetzt -- der Agent kann sie nicht aendern oder loeschen.

:::tip Immer blockierte Pfade
Unabhaengig von deiner Konfiguration greift Obsilo nie auf `.git/`, den Obsidian-Workspace-Cache oder interne Konfigurationsdateien zu. Diese sind standardmaessig blockiert.
:::

## Best Practices fuer Sicherheit

1. **Starte mit aktivierten Genehmigungen.** Lass Auto-Approve deaktiviert, bis du mit der Arbeitsweise von Obsilo vertraut bist. Beobachte die Approval Cards, um zu lernen, was der Agent tut.

2. **Aktiviere Kategorien schrittweise.** Beginne damit, Lesezugriffe automatisch zu genehmigen (niedriges Risiko), dann Notizbearbeitungen, wenn du dem Urteil des Agents vertraust. Behalte Vault-Aenderungen und Sandbox laenger auf manueller Genehmigung.

3. **Vermeide die permissive Kombination.** Genehmige nicht gleichzeitig Web-Operationen und Schreibzugriffe automatisch, es sei denn, du vertraust den Inhaltsquellen vollstaendig.

4. **Nutze die Ignore-Datei.** Wenn du sensible Notizen hast (Finanzdaten, medizinische Informationen, private Tagebuecher), fuege sie zu `.obsidian-agentignore` hinzu, bevor du dem Agent weitreichende Berechtigungen gibst.

5. **Pruefe das Operations-Log regelmaessig.** Ein kurzer Blick in die aktuellen Logs hilft dir zu verstehen, was der Agent getan hat, und Unerwartetes zu erkennen.

6. **Sichere deinen Vault.** Checkpoints bieten Undo innerhalb von Obsilo, aber ein ordentliches Vault-Backup (Obsidian Sync, Git oder Dateisystem-Backup) schuetzt vor allem.

7. **Nutze den Ask-Mode zum Erkunden.** Wenn du nur Antworten willst, ohne Aenderungen, wechsle in den Ask-Mode. Er ist von Natur aus schreibgeschuetzt -- nichts in deinem Vault kann veraendert werden.
