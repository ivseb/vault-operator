---
title: Skills, Regeln & Workflows
description: Erstelle eigene Verhaltensweisen, Einschränkungen und automatisierte Aufgabensequenzen.
---

# Skills, Regeln & Workflows

Das Verhalten von Obsilo ist vollständig anpassbar. Du kannst permanente Anweisungen hinterlegen, dem Agent neue Fähigkeiten beibringen und wiederverwendbare mehrstufige Abläufe erstellen -- ganz ohne Code.

## Die vier Bausteine

| Typ | Was er bewirkt | Ausgelöst durch | Speicherort |
|-----|---------------|-----------------|-------------|
| **Regeln** | Statische Anweisungen, die immer in den System-Prompt eingefügt werden | Immer aktiv (ein-/ausschaltbar) | `.obsidian-agent/rules/*.md` |
| **Skills** | Anleitungen, die eingefügt werden, wenn relevante Schlüsselwörter erkannt werden | Automatischer Keyword-Abgleich | `.obsidian-agent/skills/{name}/SKILL.md` |
| **Workflows** | Mehrstufige Abläufe, die per Slash-Befehl gestartet werden | `/workflow-name` im Chat | `.obsidian-agent/workflows/*.md` |
| **Custom Prompts** | Wiederverwendbare Vorlagen mit Variablen | `/`-Auswahl im Chat | Settings > Custom Prompts |

## Regeln -- Immer aktive Anweisungen

Regeln sind die einfachste Anpassungsmöglichkeit. Eine Regel ist eine Markdown-Datei, die in jede Konversation eingefügt wird.

**Regel erstellen:**
1. Navigiere zu `.obsidian-agent/rules/` in deinem Vault
2. Erstelle eine neue `.md`-Datei (z.B. `tonfall.md`)
3. Schreibe deine Anweisung in Klartext

```markdown
Antworte immer in einem freundlichen, knappen Ton.
Verwende keine Aufzählungszeichen -- nutze stattdessen nummerierte Listen.
Wenn du Notizen zusammenfasst, nenne immer das Erstellungsdatum.
```

Regeln lassen sich unter **Settings > Obsilo Agent > Rules** ein- und ausschalten. Deaktivierte Regeln bleiben im Ordner, werden aber nicht eingefügt.

:::tip Wann Regeln sinnvoll sind
Regeln eignen sich am besten für globale Vorgaben, die immer gelten sollen -- Tonfall, Formatierungspräferenzen, Sprachvorgaben oder fachspezifische Terminologie.
:::

## Skills -- Kontextabhängige Fähigkeiten

Skills sind mächtiger als Regeln. Sie werden nur dann eingefügt, wenn der Agent erkennt, dass die Konversation zum Fachgebiet des Skills passt. Das hält den System-Prompt schlank.

**Skill erstellen:**
1. Lege einen Ordner unter `.obsidian-agent/skills/` an (z.B. `meeting-notes/`)
2. Füge eine `SKILL.md`-Datei mit Frontmatter hinzu:

```markdown
---
name: Meeting Notes
description: Formatiert Besprechungsnotizen mit Teilnehmern, Entscheidungen und Action Items
---

Wenn der Benutzer dich bittet, Besprechungsnotizen zu erstellen oder zu formatieren:
1. Frage nach Titel, Datum und Teilnehmern, falls nicht angegeben
2. Strukturiere die Notiz mit diesen Abschnitten: Teilnehmer, Agenda, Diskussion, Entscheidungen, Action Items
3. Kennzeichne Action Items mit der verantwortlichen Person
4. Füge Frontmatter mit type: meeting, date und participants hinzu
```

Der Agent erkennt diesen Skill automatisch, wenn der Benutzer Meetings, Agenden oder Action Items erwähnt.

### Filterung nach Modus

Skills können auf bestimmte Modi eingeschränkt werden. Ein Skill für den Agent-Modus (schreibend) wird im Ask-Modus (nur lesend) nicht aktiviert. Das verhindert, dass der Agent Schreibaktionen vorschlägt, wenn er sie nicht ausführen kann.

### VaultDNA -- Automatische Plugin-Erkennung

VaultDNA ist eine eingebaute Funktion, die deine installierten Obsidian-Plugins scannt und automatisch Skill-Dateien dafür erzeugt. Der Agent kennt dadurch deine Dataview-Abfragen, Templater-Templates und andere Plugin-Befehle -- ohne manuelle Einrichtung.

VaultDNA läuft beim Start und aktualisiert sich, wenn Plugins geändert werden. Die generierten Skill-Dateien findest du unter `.obsidian-agent/skills/` neben deinen eigenen Skills.

:::info Keine Pflege nötig
VaultDNA-generierte Skills aktualisieren sich selbst. Du musst sie nicht bearbeiten -- aber du kannst eigene Skills erstellen, die auf den Plugin-Fähigkeiten aufbauen.
:::

## Workflows -- Mehrstufige Abläufe

Workflows funktionieren wie gespeicherte Prozeduren. Sie definieren eine Schrittfolge, der der Agent bei Auslösung folgt.

**Workflow erstellen:**
1. Erstelle eine Datei unter `.obsidian-agent/workflows/` (z.B. `wochenreview.md`)
2. Definiere die Schritte:

```markdown
# Wochenreview

1. Suche alle Notizen, die in den letzten 7 Tagen erstellt oder geändert wurden
2. Gruppiere sie nach Ordner und fasse jede Gruppe zusammen
3. Liste alle offenen Action Items auf (nicht abgehakte Checkboxen)
4. Erstelle eine neue Notiz "Wochenreview - [Datum]" mit der Zusammenfassung
5. Verschiebe die Notiz in den Reviews/-Ordner
```

**Auslösen:** Tippe `/wochenreview` in die Chat-Eingabe. Der Agent folgt den Schritten der Reihe nach.

## Custom Prompts -- Schnellvorlagen

Custom Prompts sind wiederverwendbare Nachrichtenvorlagen mit Variablen-Platzhaltern.

| Variable | Wird ersetzt durch |
|----------|-------------------|
| `{{userInput}}` | Was du nach der Auswahl des Prompts eingibst |
| `{{activeFile}}` | Den Inhalt der aktuell geöffneten Notiz |

**Beispiel:** Ein Prompt namens "Erkläre es einfach" mit der Vorlage `Erkläre das Folgende in einfachen Worten, die ein Anfänger verstehen würde: {{activeFile}}`.

Erstelle und verwalte Custom Prompts unter **Settings > Obsilo Agent > Custom Prompts**, oder tippe `/` im Chat, um sie zu durchsuchen und auszulösen.

## Das richtige Werkzeug wählen

| Du möchtest... | Verwende |
|----------------|----------|
| Eine permanente Formatierungs- oder Tonfall-Vorgabe setzen | Regel |
| Dem Agent einen fachspezifischen Prozess beibringen | Skill |
| Eine wiederholbare mehrstufige Prozedur erstellen | Workflow |
| Einen häufig genutzten Prompt speichern | Custom Prompt |

:::warning Regeln fokussiert halten
Zu viele Regeln blähen den System-Prompt auf und können das Modell verwirren. Nutze Skills für Spezialwissen -- sie werden nur bei Bedarf aktiviert.
:::

## Nächste Schritte

- [Office-Dokumente](/de/guide/advanced/office-documents) -- Erstelle Präsentationen, Dokumente und Tabellen
- [Connectors](/de/guide/advanced/connectors) -- Verbinde externe Tools und stelle deinen Vault bereit
- [Multi-Agent & Tasks](/de/guide/advanced/multi-agent) -- Delegiere Arbeit an Sub-Agents
