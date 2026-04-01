---
title: Gedaechtnis & Personalisierung
description: Wie Obsilo sich deine Praeferenzen, Projekte und Muster ueber Gespraeche hinweg merkt.
---

# Gedaechtnis & Personalisierung

Obsilo kann sich merken, was dir wichtig ist, wie du gerne arbeitest und was ihr zuvor besprochen habt. Diese Seite erklaert, wie das Gedaechtnissystem funktioniert und wie du das Beste daraus machst.

## Wie Obsilo sich erinnert

Obsilo verwendet ein dreistufiges Gedaechtnissystem. Jede Stufe dient einem anderen Zweck:

| Stufe | Was gespeichert wird | Wie es funktioniert |
|-------|---------------------|---------------------|
| **Session-Gedaechtnis** | Eine Zusammenfassung jedes Gespraechs -- was erreicht wurde, getroffene Entscheidungen, offene Fragen | Wird automatisch erstellt, wenn ein Gespraech endet |
| **Langzeitgedaechtnis** | Dauerhafte Fakten, die aus Sessions heraufgestuft werden -- deine Praeferenzen, aktive Projekte, Workflow-Muster | Wird im Hintergrund extrahiert, indem Session-Zusammenfassungen mit dem bestehenden Gedaechtnis verglichen werden |
| **Soul** | Kernverstaendnis von dir -- Kommunikationsstil, Persoenlichkeitspraeferenzen, wie der Agent sich verhalten soll | Wird aktualisiert, wenn Sessions neue Praeferenzen oder Korrekturen offenbaren |

Alle Gedaechtnisdateien werden in `.obsidian-agent/memory/` im Plugin-Verzeichnis deines Vaults gespeichert. Es sind einfache Markdown-Dateien, die du jederzeit lesen, bearbeiten oder loeschen kannst.

:::tip Du hast immer die Kontrolle
Gedaechtnisdateien sind nur Text. Oeffne sie in einem beliebigen Editor, um genau zu sehen, was Obsilo sich merkt. Loesche eine Datei, um Obsilo diese Kategorie komplett vergessen zu lassen.
:::

## Chat-Verlauf

Jedes Gespraech wird automatisch gespeichert (wenn der Chat-Verlauf aktiviert ist). Du kannst vergangene Gespraeche durchsuchen, wiederherstellen und fortsetzen.

**So greifst du auf deinen Chat-Verlauf zu:**

1. Klicke auf das **Uhr-Icon** in der Chat-Toolbar
2. Ein einschiebbares Panel zeigt alle vergangenen Gespraeche, gruppiert nach Datum (Heute, Gestern, Diese Woche, Aelter)
3. Klicke auf ein beliebiges Gespraech, um es **wiederherzustellen** und dort weiterzumachen, wo du aufgehoert hast

Gespraeche zeigen die Startzeit und einen kurzen Titel an. Wenn du ein Titling-Modell konfiguriert hast (siehe Chat-Linking weiter unten), werden Titel automatisch basierend auf dem Gespraechsinhalt generiert.

## Chat-Linking

Wenn Obsilo eine Notiz erstellt oder bearbeitet, kann es einen Link zurueck zum Gespraech in das Frontmatter der Notiz einfuegen. So kannst du jede Aenderung bis zum Gespraech zurueckverfolgen, das sie ausgeloest hat.

**So funktioniert es:**

- Ein `obsilo-chat`-Feld wird zum YAML-Frontmatter der Notiz hinzugefuegt
- Der Wert ist ein klickbarer Link im Format `obsidian://obsilo-chat?id=...`
- Ein Klick auf den Link oeffnet Obsilo und springt direkt zu diesem Gespraech

**Semantische Titel:** Wenn du ein kleines, schnelles Modell (wie Haiku oder GPT-4o mini) als Titling-Modell konfigurierst, generiert Obsilo automatisch aussagekraeftige Gespraechstitel. Ohne Titling-Modell werden stattdessen die ersten 60 Zeichen des Gespraechs verwendet.

**Chat-Linking konfigurieren:** Gehe zu **Settings > Obsilo Agent > Interface** und suche den Schalter "Auto-link chats in frontmatter". Dort kannst du auch dein bevorzugtes Titling-Modell auswaehlen.

:::info Kostenspar-Tipp
Verwende ein guenstiges, schnelles Modell fuer das Titling (getrennt von deinem Hauptmodell). Es muss nur einen kurzen Titel generieren, daher funktionieren selbst die kleinsten Modelle hier gut.
:::

## Der Onboarding-Wizard

Wenn du Obsilo zum ersten Mal installierst, fuehrt dich ein Konversations-Wizard durch die Grundlagen:

1. **Vorstellung** -- Obsilo stellt sich vor und fragt nach deinem Namen
2. **Benennung** -- Du kannst den Agent umbenennen, wenn du einen anderen Namen bevorzugst
3. **Backup-Erinnerung** -- Eine Aufforderung, deinen Vault zu sichern, bevor der Agent schreibt
4. **Berechtigungen** -- Waehle dein Komfortniveau fuer automatische Genehmigungen
5. **Profil** -- Teile mit, wofuer du deinen Vault nutzt, damit Obsilo seine Hilfe anpassen kann

Der Wizard laeuft als normales Chat-Gespraech -- keine Formulare oder Popups. Deine Antworten werden sofort im Gedaechtnis gespeichert, sodass Obsilo schon ab der ersten echten Aufgabe personalisiert arbeitet.

## Gedaechtnis-Einstellungen

Oeffne **Settings > Obsilo Agent > Memory** zur Konfiguration:

| Einstellung | Was sie bewirkt | Standard |
|-------------|----------------|----------|
| **Enable memory** | Hauptschalter fuer das gesamte Gedaechtnissystem | An |
| **Auto-extract sessions** | Erstellt automatisch eine Session-Zusammenfassung, wenn ein Gespraech endet | An |
| **Auto-update long-term** | Stuft dauerhafte Fakten aus Sessions ins Langzeitgedaechtnis herauf | An |
| **Memory model** | Welches AI-Modell die Extraktion durchfuehrt (waehle ein guenstiges) | Dein erstes Modell |
| **Minimum messages** | Gespraeche, die kuerzer als dieser Schwellenwert sind, werden uebersprungen (Bereich: 2--20) | 4 |
| **Chat history** | Gespraeche speichern, um sie durchsuchen und wiederherstellen zu koennen | An |

:::warning Waehle ein kostenguenstiges Memory-Modell
Die Gedaechtnis-Extraktion laeuft nach jedem qualifizierenden Gespraech. Waehle ein kleines, guenstiges Modell (wie Haiku, Flash oder GPT-4o mini), um die Kosten niedrig zu halten. Die Extraktionsaufgabe ist einfach und erfordert kein leistungsstarkes Modell.
:::

## Nutzerprofil

Waehrend du mit Obsilo arbeitest, baut es ein Profil deiner Praeferenzen in `user-profile.md` auf. Das umfasst unter anderem:

- Deinen Namen und wie du angesprochen werden moechtest
- Themen und Projekte, an denen du arbeitest
- Kommunikationsstil-Praeferenzen (kurz vs. ausfuehrlich, formell vs. locker)
- Tools und Workflows, die du haeufig nutzt

Der Agent liest dieses Profil zu Beginn jedes Gespraechs, um seine Antworten zu personalisieren. Du kannst die Datei direkt bearbeiten, um Informationen zu korrigieren oder hinzuzufuegen.

## Tipps fuer das Beste aus dem Gedaechtnis

1. **Fuehre echte Gespraeche.** Je mehr du interagierst, desto besser versteht Obsilo deine Praeferenzen. Kurze Einzelfragen erzeugen nicht viel Gedaechtnis.

2. **Korrigiere den Agent.** Wenn Obsilo eine Praeferenz falsch versteht, sag es ihm. Korrekturen werden bei der Gedaechtnis-Extraktion priorisiert.

3. **Pruefe gelegentlich deine Gedaechtnisdateien.** Oeffne `.obsidian-agent/memory/` und sieh die Dateien durch. Entferne alles, was veraltet oder falsch ist.

4. **Nutze den Mindestanzahl-Schwellenwert sinnvoll.** Wenn du oft kurze Chats fuehrst, die es nicht wert sind, gemerkt zu werden, erhoehe den Schwellenwert. Wenn jedes Gespraech zaehlt, senke ihn.

5. **Lass Chat-Linking aktiviert.** Die Frontmatter-Links erzeugen einen natuerlichen Audit-Trail -- du kannst immer nachvollziehen, *warum* eine Notiz geaendert wurde und *was besprochen wurde*.
