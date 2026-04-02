---
title: Gedächtnis & Personalisierung
description: Wie Obsilo sich deine Präferenzen, Projekte und Muster über Gespräche hinweg merkt.
---

# Gedächtnis & Personalisierung

Obsilo kann sich merken, was dir wichtig ist, wie du gerne arbeitest und was ihr zuvor besprochen habt. Diese Seite erklärt, wie das Gedächtnissystem funktioniert und wie du das Beste daraus machst.

## Wie Obsilo sich erinnert

Obsilo verwendet ein dreistufiges Gedächtnissystem. Jede Stufe dient einem anderen Zweck:

| Stufe | Was gespeichert wird | Wie es funktioniert |
|-------|---------------------|---------------------|
| **Session-Gedächtnis** | Eine Zusammenfassung jedes Gesprächs -- was erreicht wurde, getroffene Entscheidungen, offene Fragen | Wird automatisch erstellt, wenn ein Gespräch endet |
| **Langzeitgedächtnis** | Dauerhafte Fakten, die aus Sessions heraufgestuft werden -- deine Präferenzen, aktive Projekte, Workflow-Muster | Wird im Hintergrund extrahiert, indem Session-Zusammenfassungen mit dem bestehenden Gedächtnis verglichen werden |
| **Soul** | Kernverständnis von dir -- Kommunikationsstil, Persönlichkeitspräferenzen, wie der Agent sich verhalten soll | Wird aktualisiert, wenn Sessions neue Präferenzen oder Korrekturen offenbaren |

Alle Gedächtnisdateien werden in `.obsidian-agent/memory/` im Plugin-Verzeichnis deines Vaults gespeichert. Es sind einfache Markdown-Dateien, die du jederzeit lesen, bearbeiten oder löschen kannst.

:::tip Du hast immer die Kontrolle
Gedächtnisdateien sind nur Text. Öffne sie in einem beliebigen Editor, um genau zu sehen, was Obsilo sich merkt. Lösche eine Datei, um Obsilo diese Kategorie komplett vergessen zu lassen.
:::

## Chat-Verlauf

Jedes Gespräch wird automatisch gespeichert (wenn der Chat-Verlauf aktiviert ist). Du kannst vergangene Gespräche durchsuchen, wiederherstellen und fortsetzen.

**So greifst du auf deinen Chat-Verlauf zu:**

1. Klicke auf das **Uhr-Icon** in der Chat-Toolbar
2. Ein einschiebbares Panel zeigt alle vergangenen Gespräche, gruppiert nach Datum (Heute, Gestern, Diese Woche, Älter)
3. Klicke auf ein beliebiges Gespräch, um es **wiederherzustellen** und dort weiterzumachen, wo du aufgehört hast

Gespräche zeigen die Startzeit und einen kurzen Titel an. Wenn du ein Titling-Modell konfiguriert hast (siehe Chat-Linking weiter unten), werden Titel automatisch basierend auf dem Gesprächsinhalt generiert.

## Chat-Linking

Wenn Obsilo eine Notiz erstellt oder bearbeitet, kann es einen Link zurück zum Gespräch in das Frontmatter der Notiz einfügen. So kannst du jede Änderung bis zum Gespräch zurückverfolgen, das sie ausgelöst hat.

**So funktioniert es:**

- Ein `obsilo-chat`-Feld wird zum YAML-Frontmatter der Notiz hinzugefügt
- Der Wert ist ein klickbarer Link im Format `obsidian://obsilo-chat?id=...`
- Ein Klick auf den Link öffnet Obsilo und springt direkt zu diesem Gespräch

**Semantische Titel:** Wenn du ein kleines, schnelles Modell (wie Haiku oder GPT-4o mini) als Titling-Modell konfigurierst, generiert Obsilo automatisch aussagekräftige Gesprächstitel. Ohne Titling-Modell werden stattdessen die ersten 60 Zeichen des Gesprächs verwendet.

**Chat-Linking konfigurieren:** Gehe zu **Settings > Obsilo Agent > Interface** und suche den Schalter "Auto-link chats in frontmatter". Dort kannst du auch dein bevorzugtes Titling-Modell auswählen.

:::info Kostenspar-Tipp
Verwende ein günstiges, schnelles Modell für das Titling (getrennt von deinem Hauptmodell). Es muss nur einen kurzen Titel generieren, daher funktionieren selbst die kleinsten Modelle hier gut.
:::

## Der Onboarding-Wizard

Wenn du Obsilo zum ersten Mal installierst, führt dich ein Konversations-Wizard durch die Grundlagen:

1. **Vorstellung** -- Obsilo stellt sich vor und fragt nach deinem Namen
2. **Benennung** -- Du kannst den Agent umbenennen, wenn du einen anderen Namen bevorzugst
3. **Backup-Erinnerung** -- Eine Aufforderung, deinen Vault zu sichern, bevor der Agent schreibt
4. **Berechtigungen** -- Wähle dein Komfortniveau für automatische Genehmigungen
5. **Profil** -- Teile mit, wofür du deinen Vault nutzt, damit Obsilo seine Hilfe anpassen kann

Der Wizard läuft als normales Chat-Gespräch -- keine Formulare oder Popups. Deine Antworten werden sofort im Gedächtnis gespeichert, sodass Obsilo schon ab der ersten echten Aufgabe personalisiert arbeitet.

## Gedächtnis-Einstellungen

Öffne **Settings > Obsilo Agent > Memory** zur Konfiguration:

| Einstellung | Was sie bewirkt | Standard |
|-------------|----------------|----------|
| **Enable memory** | Hauptschalter für das gesamte Gedächtnissystem | An |
| **Auto-extract sessions** | Erstellt automatisch eine Session-Zusammenfassung, wenn ein Gespräch endet | An |
| **Auto-update long-term** | Stuft dauerhafte Fakten aus Sessions ins Langzeitgedächtnis herauf | An |
| **Memory model** | Welches AI-Modell die Extraktion durchführt (wähle ein günstiges) | Dein erstes Modell |
| **Minimum messages** | Gespräche, die kürzer als dieser Schwellenwert sind, werden übersprungen (Bereich: 2--20) | 4 |
| **Chat history** | Gespräche speichern, um sie durchsuchen und wiederherstellen zu können | An |

:::warning Wähle ein kostengünstiges Memory-Modell
Die Gedächtnis-Extraktion läuft nach jedem qualifizierenden Gespräch. Wähle ein kleines, günstiges Modell (wie Haiku, Flash oder GPT-4o mini), um die Kosten niedrig zu halten. Die Extraktionsaufgabe ist einfach und erfordert kein leistungsstarkes Modell.
:::

## Nutzerprofil

Während du mit Obsilo arbeitest, baut es ein Profil deiner Präferenzen in `user-profile.md` auf. Das umfasst unter anderem:

- Deinen Namen und wie du angesprochen werden möchtest
- Themen und Projekte, an denen du arbeitest
- Kommunikationsstil-Präferenzen (kurz vs. ausführlich, formell vs. locker)
- Tools und Workflows, die du häufig nutzt

Der Agent liest dieses Profil zu Beginn jedes Gesprächs, um seine Antworten zu personalisieren. Du kannst die Datei direkt bearbeiten, um Informationen zu korrigieren oder hinzuzufügen.

## Tipps für das Beste aus dem Gedächtnis

1. **Führe echte Gespräche.** Je mehr du interagierst, desto besser versteht Obsilo deine Präferenzen. Kurze Einzelfragen erzeugen nicht viel Gedächtnis.

2. **Korrigiere den Agent.** Wenn Obsilo eine Präferenz falsch versteht, sag es ihm. Korrekturen werden bei der Gedächtnis-Extraktion priorisiert.

3. **Prüfe gelegentlich deine Gedächtnisdateien.** Öffne `.obsidian-agent/memory/` und sieh die Dateien durch. Entferne alles, was veraltet oder falsch ist.

4. **Nutze den Mindestanzahl-Schwellenwert sinnvoll.** Wenn du oft kurze Chats führst, die es nicht wert sind, gemerkt zu werden, erhöhe den Schwellenwert. Wenn jedes Gespräch zählt, senke ihn.

5. **Lass Chat-Linking aktiviert.** Die Frontmatter-Links erzeugen einen natürlichen Audit-Trail -- du kannst immer nachvollziehen, *warum* eine Notiz geändert wurde und *was besprochen wurde*.
