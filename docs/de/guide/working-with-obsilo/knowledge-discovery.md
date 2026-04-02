---
title: Wissen entdecken
description: Semantische Suche, Wissensgraph, implizite Verbindungen und lokales Reranking.
---

# Wissen entdecken

Die meisten Suchwerkzeuge finden nur exakte Wörter. Obsilo geht weiter: Es versteht **Bedeutung**. Eine Suche nach "Fokus verbessern" kann eine Notiz mit dem Titel "Deep Work Techniken" finden, auch wenn die Wörter sich nicht überschneiden. Diese Seite erklärt, wie du das einrichtest und optimal nutzt.

## Was ist semantische Suche?

Herkömmliche Keyword-Suche sucht nach exakten Texttreffern. Semantische Suche wandelt deine Notizen in mathematische Repräsentationen um (sogenannte **Embeddings**), die ihre Bedeutung erfassen. Bei einer Suche wird deine Anfrage ebenfalls umgewandelt, und das System findet die Notizen, deren Bedeutung deiner Frage am nächsten kommt.

Das bedeutet:
- *"Rezepte für Pasta"* findet Notizen über italienische Küche, auch wenn sie nie das Wort "Pasta" enthalten
- *"Wie schlafe ich besser"* findet deine Notiz mit dem Titel "Abendroutine zum Runterkommen"
- *"Budgetplanung"* findet Notizen über Finanzprognosen und Ausgabenverfolgung

## Einrichtung

Semantische Suche erfordert ein **Embedding-Modell**, um Text in Embeddings umzuwandeln. Du richtest das einmal ein, und Obsilo übernimmt den Rest.

1. Öffne **Settings > Obsilo Agent > Embeddings**
2. Wähle ein Embedding-Modell aus dem Dropdown
3. Klicke auf **Build Index**, um deinen Vault zu verarbeiten

:::tip Welches Embedding-Modell?
Jeder konfigurierte Provider, der Embeddings unterstützt, funktioniert. Wenn du OpenAI oder eine kompatible API verwendest, ist das Standard-Embedding-Modell ein guter Ausgangspunkt. Lokale Modelle über Ollama eignen sich ebenfalls gut, wenn dir Datenschutz wichtig ist.
:::

### Index aufbauen

Der erste Build verarbeitet jede Notiz in deinem Vault. Bei großen Vaults (1000+ Notizen) kann das einige Minuten dauern. Nach dem initialen Build aktualisiert sich der Index automatisch:

- **Beim Start** -- neue oder geänderte Dateien werden neu indiziert
- **Bei Dateiänderungen** -- Bearbeitungen lösen nach kurzer Verzögerung eine Neuindizierung aus
- **Manuell** -- nutze jederzeit den Button **Rebuild Index** in den Einstellungen

:::info Deine Notizen bleiben lokal
Embeddings werden in einer lokalen Datenbank innerhalb deines Vaults gespeichert. Wenn du ein Cloud-Embedding-Modell verwendest, werden Notizinhalte zur Verarbeitung an den Provider gesendet, aber die resultierenden Embeddings werden ausschließlich auf deinem Rechner gespeichert. Mit einem lokalen Modell verlässt nichts dein Gerät.
:::

## Wie die Suche unter der Haube funktioniert

Wenn du oder der Agent eine semantische Suche ausführen, verwendet Obsilo einen **hybriden Ansatz**, der mehrere Strategien für die besten Ergebnisse kombiniert:

### 1. BM25 (Keyword-Matching)

Ein schneller, traditioneller Ranking-Algorithmus. Er findet Notizen, die deine Suchbegriffe enthalten, und sortiert sie nach Relevanz. Gut für spezifische Begriffe wie Namen, Daten oder Fachbegriffe.

### 2. Semantische Ähnlichkeit (Embedding-Matching)

Vergleicht die Bedeutung deiner Anfrage mit den Embeddings jedes Chunks in deinem Vault. Findet konzeptionell verwandte Notizen auch ohne übereinstimmende Schlüsselwörter.

### 3. Reciprocal Rank Fusion (RRF)

Kombiniert die Ergebnisse aus BM25 und semantischer Suche zu einer einzigen, sortierten Liste. Notizen, die bei beiden Methoden gut abschneiden, steigen nach oben. Dieser hybride Ansatz übertrifft konsistent jede einzelne Methode allein.

## Der Wissensgraph

Über die Suche hinaus baut Obsilo einen **Wissensgraphen** aus der bereits vorhandenen Struktur deines Vaults:

- **Wikilinks** -- `[[Notiz]]`-Verbindungen zwischen deinen Notizen
- **Tags** -- gemeinsame Tags erzeugen implizite Gruppierungen
- **MOC-Properties** -- Maps of Content verknüpfen verwandte Themen

Wenn der Agent sucht, kann er **Ergebnisse über den Graphen erweitern**. Findet eine Suche Notiz A, und Notiz A verlinkt auf Notiz B, kann der Agent diesem Link folgen, um zusätzliche relevante Inhalte zu entdecken. In den Einstellungen kannst du konfigurieren, wie viele "Hops" die Graph-Erweiterung verfolgt.

**Beispiel:** Eine Suche nach "Machine Learning" findet deine Notiz über Neuronale Netze. Die Graph-Erweiterung folgt dann den Wikilinks zu deinen Notizen über Trainingsdaten und Modellbewertung -- verwandte Themen, die du mit einer Suche allein vielleicht nicht gefunden hättest.

## Implizite Verbindungen

Dies ist eine der stärksten Funktionen von Obsilo. Es findet automatisch Notizen, die **semantisch ähnlich, aber nicht miteinander verlinkt** sind.

Stell dir vor, der Agent sagt: *"Diese beiden Notizen handeln von sehr ähnlichen Themen, aber du hast sie nie miteinander verbunden. Das könntest du tun."*

Wenn implizite Verbindungen gefunden werden, erscheint ein **Suggestion Banner** in der Seitenleiste, das anbietet, dir die entdeckten Zusammenhänge zu zeigen. Das kann überraschende Verbindungen quer durch verschiedene Bereiche deines Vaults aufdecken.

:::tip Ideal für große Vaults
Je größer dein Vault, desto wertvoller werden implizite Verbindungen. Notizen, die Monate auseinander zu verwandten Themen geschrieben wurden, sind manuell leicht zu übersehen.
:::

## Lokales Reranking

Nachdem die initiale Suche Kandidaten zurückgeliefert hat, kann Obsilo einen zweiten Durchgang mit einem **Cross-Encoder-Modell** durchführen, um die Ergebnisqualität zu verbessern. Dieses Modell läuft vollständig auf deinem Gerät über WebAssembly -- es werden keine Daten nach außen gesendet.

Der Reranker (basierend auf ms-marco-MiniLM) liest jeden Kandidaten zusammen mit deiner Anfrage und erzeugt einen genaueren Relevanzwert. Ergebnisse, die vielversprechend aussahen, aber tatsächlich nicht relevant sind, werden nach unten verschoben; wirklich relevante Ergebnisse steigen auf.

Das geschieht automatisch, wenn aktiviert. Du kannst es unter **Settings > Obsilo Agent > Embeddings > Local Reranking** umschalten.

## Contextual Retrieval

Wenn aktiviert, reichert Obsilo jeden Chunk mit zusätzlichem Kontext an, bevor sein Embedding erstellt wird. Der Agent nutzt den umgebenden Inhalt der Notiz, um eine kurze Beschreibung hinzuzufügen, worum es in jedem Chunk geht. Das verbessert die Suchgenauigkeit, besonders bei kurzen oder mehrdeutigen Passagen.

Zum Beispiel wird ein Chunk, der nur eine Zahlentabelle enthält, viel besser auffindbar, wenn das System Kontext wie "Quartalsumsätze aus dem Finanzbericht 2025" hinzufügt.

## Konfigurationstipps

| Einstellung | Wo | Empfehlung |
|-------------|-----|------------|
| **Embedding-Modell** | Settings > Embeddings | Wähle basierend auf deinen Datenschutzbedürfnissen und deinem Provider |
| **Chunk-Größe** | Settings > Embeddings > Advanced | Standard funktioniert für die meisten Vaults. Kleinere Chunks (256 Tokens) für kurze Notizen, größere (1024) für längere Texte |
| **Ausgeschlossene Ordner** | Settings > Embeddings > Excluded | Schließe Templates, Archive oder Anhangsordner aus, um den Index fokussiert zu halten |
| **Auto-Index** | Settings > Embeddings | Aktiviert lassen für automatische Aktualisierung bei Dateiänderungen |
| **Graph-Hops** | Settings > Embeddings > Graph | 1-2 Hops reichen normalerweise. Mehr Hops finden breitere Verbindungen, können aber Rauschen enthalten |
| **Lokales Reranking** | Settings > Embeddings | Aktivieren für bessere Ergebnisqualität bei minimalem Performance-Aufwand |

:::warning Große Vaults und Performance
Bei Vaults mit 5000+ Notizen kann der initiale Index-Build je nach Embedding-Modell 10-20 Minuten dauern. Danach sind inkrementelle Updates schnell. Erwäge, große Anhangsordner oder Archive, die du selten durchsuchst, auszuschließen.
:::

## Praktische Beispiele

- *"Finde Notizen, die mit meinen Zielen für dieses Jahr zusammenhängen"* -- semantische Suche findet Notizen über Vorsätze, Pläne und Ziele
- *"Was weiß ich über verteilte Systeme?"* -- sucht nach Bedeutung in deinem gesamten Vault
- *"Zeig mir Notizen, die ähnlich zu @architecture-decisions sind"* -- findet thematisch verwandte Notizen
- *"Gibt es Notizen, die ich miteinander verlinken sollte?"* -- löst die Erkennung impliziter Verbindungen aus

## Nächste Schritte

- [Vault-Operationen](/de/guide/working-with-obsilo/vault-operations) -- Lesen, Schreiben und Organisieren deiner Dateien
- [Gedächtnis & Personalisierung](/de/guide/working-with-obsilo/memory-personalization) -- Wie Obsilo sich deine Präferenzen merkt
- [Einstellungsreferenz](/de/guide/reference/settings) -- Alle Embedding- und Sucheinstellungen erklärt
