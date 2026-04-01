---
title: Wissen entdecken
description: Semantische Suche, Wissensgraph, implizite Verbindungen und lokales Reranking.
---

# Wissen entdecken

Die meisten Suchwerkzeuge finden nur exakte Woerter. Obsilo geht weiter: Es versteht **Bedeutung**. Eine Suche nach "Fokus verbessern" kann eine Notiz mit dem Titel "Deep Work Techniken" finden, auch wenn die Woerter sich nicht ueberschneiden. Diese Seite erklaert, wie du das einrichtest und optimal nutzt.

## Was ist semantische Suche?

Herkoemmliche Keyword-Suche sucht nach exakten Texttreffern. Semantische Suche wandelt deine Notizen in mathematische Repraesentationen um (sogenannte **Embeddings**), die ihre Bedeutung erfassen. Bei einer Suche wird deine Anfrage ebenfalls umgewandelt, und das System findet die Notizen, deren Bedeutung deiner Frage am naechsten kommt.

Das bedeutet:
- *"Rezepte fuer Pasta"* findet Notizen ueber italienische Kueche, auch wenn sie nie das Wort "Pasta" enthalten
- *"Wie schlafe ich besser"* findet deine Notiz mit dem Titel "Abendroutine zum Runterkommen"
- *"Budgetplanung"* findet Notizen ueber Finanzprognosen und Ausgabenverfolgung

## Einrichtung

Semantische Suche erfordert ein **Embedding-Modell**, um Text in Embeddings umzuwandeln. Du richtest das einmal ein, und Obsilo uebernimmt den Rest.

1. Oeffne **Settings > Obsilo Agent > Embeddings**
2. Waehle ein Embedding-Modell aus dem Dropdown
3. Klicke auf **Build Index**, um deinen Vault zu verarbeiten

:::tip Welches Embedding-Modell?
Jeder konfigurierte Provider, der Embeddings unterstuetzt, funktioniert. Wenn du OpenAI oder eine kompatible API verwendest, ist das Standard-Embedding-Modell ein guter Ausgangspunkt. Lokale Modelle ueber Ollama eignen sich ebenfalls gut, wenn dir Datenschutz wichtig ist.
:::

### Index aufbauen

Der erste Build verarbeitet jede Notiz in deinem Vault. Bei grossen Vaults (1000+ Notizen) kann das einige Minuten dauern. Nach dem initialen Build aktualisiert sich der Index automatisch:

- **Beim Start** -- neue oder geaenderte Dateien werden neu indiziert
- **Bei Dateiaenderungen** -- Bearbeitungen loesen nach kurzer Verzoegerung eine Neuindizierung aus
- **Manuell** -- nutze jederzeit den Button **Rebuild Index** in den Einstellungen

:::info Deine Notizen bleiben lokal
Embeddings werden in einer lokalen Datenbank innerhalb deines Vaults gespeichert. Wenn du ein Cloud-Embedding-Modell verwendest, werden Notizinhalte zur Verarbeitung an den Provider gesendet, aber die resultierenden Embeddings werden ausschliesslich auf deinem Rechner gespeichert. Mit einem lokalen Modell verlaesst nichts dein Geraet.
:::

## Wie die Suche unter der Haube funktioniert

Wenn du oder der Agent eine semantische Suche ausfuehren, verwendet Obsilo einen **hybriden Ansatz**, der mehrere Strategien fuer die besten Ergebnisse kombiniert:

### 1. BM25 (Keyword-Matching)

Ein schneller, traditioneller Ranking-Algorithmus. Er findet Notizen, die deine Suchbegriffe enthalten, und sortiert sie nach Relevanz. Gut fuer spezifische Begriffe wie Namen, Daten oder Fachbegriffe.

### 2. Semantische Aehnlichkeit (Embedding-Matching)

Vergleicht die Bedeutung deiner Anfrage mit den Embeddings jedes Chunks in deinem Vault. Findet konzeptionell verwandte Notizen auch ohne uebereinstimmende Schluesselwoerter.

### 3. Reciprocal Rank Fusion (RRF)

Kombiniert die Ergebnisse aus BM25 und semantischer Suche zu einer einzigen, sortierten Liste. Notizen, die bei beiden Methoden gut abschneiden, steigen nach oben. Dieser hybride Ansatz uebertrifft konsistent jede einzelne Methode allein.

## Der Wissensgraph

Ueber die Suche hinaus baut Obsilo einen **Wissensgraphen** aus der bereits vorhandenen Struktur deines Vaults:

- **Wikilinks** -- `[[Notiz]]`-Verbindungen zwischen deinen Notizen
- **Tags** -- gemeinsame Tags erzeugen implizite Gruppierungen
- **MOC-Properties** -- Maps of Content verknuepfen verwandte Themen

Wenn der Agent sucht, kann er **Ergebnisse ueber den Graphen erweitern**. Findet eine Suche Notiz A, und Notiz A verlinkt auf Notiz B, kann der Agent diesem Link folgen, um zusaetzliche relevante Inhalte zu entdecken. In den Einstellungen kannst du konfigurieren, wie viele "Hops" die Graph-Erweiterung verfolgt.

**Beispiel:** Eine Suche nach "Machine Learning" findet deine Notiz ueber Neuronale Netze. Die Graph-Erweiterung folgt dann den Wikilinks zu deinen Notizen ueber Trainingsdaten und Modellbewertung -- verwandte Themen, die du mit einer Suche allein vielleicht nicht gefunden haettest.

## Implizite Verbindungen

Dies ist eine der staerksten Funktionen von Obsilo. Es findet automatisch Notizen, die **semantisch aehnlich, aber nicht miteinander verlinkt** sind.

Stell dir vor, der Agent sagt: *"Diese beiden Notizen handeln von sehr aehnlichen Themen, aber du hast sie nie miteinander verbunden. Das koenntest du tun."*

Wenn implizite Verbindungen gefunden werden, erscheint ein **Suggestion Banner** in der Seitenleiste, das anbietet, dir die entdeckten Zusammenhaenge zu zeigen. Das kann ueberraschende Verbindungen quer durch verschiedene Bereiche deines Vaults aufdecken.

:::tip Ideal fuer grosse Vaults
Je groesser dein Vault, desto wertvoller werden implizite Verbindungen. Notizen, die Monate auseinander zu verwandten Themen geschrieben wurden, sind manuell leicht zu uebersehen.
:::

## Lokales Reranking

Nachdem die initiale Suche Kandidaten zurueckgeliefert hat, kann Obsilo einen zweiten Durchgang mit einem **Cross-Encoder-Modell** durchfuehren, um die Ergebnisqualitaet zu verbessern. Dieses Modell laeuft vollstaendig auf deinem Geraet ueber WebAssembly -- es werden keine Daten nach aussen gesendet.

Der Reranker (basierend auf ms-marco-MiniLM) liest jeden Kandidaten zusammen mit deiner Anfrage und erzeugt einen genaueren Relevanzwert. Ergebnisse, die vielversprechend aussahen, aber tatsaechlich nicht relevant sind, werden nach unten verschoben; wirklich relevante Ergebnisse steigen auf.

Das geschieht automatisch, wenn aktiviert. Du kannst es unter **Settings > Obsilo Agent > Embeddings > Local Reranking** umschalten.

## Contextual Retrieval

Wenn aktiviert, reichert Obsilo jeden Chunk mit zusaetzlichem Kontext an, bevor sein Embedding erstellt wird. Der Agent nutzt den umgebenden Inhalt der Notiz, um eine kurze Beschreibung hinzuzufuegen, worum es in jedem Chunk geht. Das verbessert die Suchgenauigkeit, besonders bei kurzen oder mehrdeutigen Passagen.

Zum Beispiel wird ein Chunk, der nur eine Zahlentabelle enthaelt, viel besser auffindbar, wenn das System Kontext wie "Quartalsumsaetze aus dem Finanzbericht 2025" hinzufuegt.

## Konfigurationstipps

| Einstellung | Wo | Empfehlung |
|-------------|-----|------------|
| **Embedding-Modell** | Settings > Embeddings | Waehle basierend auf deinen Datenschutzbeduerfnissen und deinem Provider |
| **Chunk-Groesse** | Settings > Embeddings > Advanced | Standard funktioniert fuer die meisten Vaults. Kleinere Chunks (256 Tokens) fuer kurze Notizen, groessere (1024) fuer laengere Texte |
| **Ausgeschlossene Ordner** | Settings > Embeddings > Excluded | Schliesse Templates, Archive oder Anhangsordner aus, um den Index fokussiert zu halten |
| **Auto-Index** | Settings > Embeddings | Aktiviert lassen fuer automatische Aktualisierung bei Dateiaenderungen |
| **Graph-Hops** | Settings > Embeddings > Graph | 1-2 Hops reichen normalerweise. Mehr Hops finden breitere Verbindungen, koennen aber Rauschen enthalten |
| **Lokales Reranking** | Settings > Embeddings | Aktivieren fuer bessere Ergebnisqualitaet bei minimalem Performance-Aufwand |

:::warning Grosse Vaults und Performance
Bei Vaults mit 5000+ Notizen kann der initiale Index-Build je nach Embedding-Modell 10-20 Minuten dauern. Danach sind inkrementelle Updates schnell. Erwaege, grosse Anhangsordner oder Archive, die du selten durchsuchst, auszuschliessen.
:::

## Praktische Beispiele

- *"Finde Notizen, die mit meinen Zielen fuer dieses Jahr zusammenhaengen"* -- semantische Suche findet Notizen ueber Vorsaetze, Plaene und Ziele
- *"Was weiss ich ueber verteilte Systeme?"* -- sucht nach Bedeutung in deinem gesamten Vault
- *"Zeig mir Notizen, die aehnlich zu @architecture-decisions sind"* -- findet thematisch verwandte Notizen
- *"Gibt es Notizen, die ich miteinander verlinken sollte?"* -- loest die Erkennung impliziter Verbindungen aus

## Naechste Schritte

- [Vault-Operationen](/de/guide/working-with-obsilo/vault-operations) -- Lesen, Schreiben und Organisieren deiner Dateien
- [Gedaechtnis & Personalisierung](/de/guide/working-with-obsilo/memory-personalization) -- Wie Obsilo sich deine Praeferenzen merkt
- [Einstellungsreferenz](/de/guide/reference/settings) -- Alle Embedding- und Sucheinstellungen erklaert
