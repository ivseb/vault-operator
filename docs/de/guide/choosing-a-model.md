---
title: Modell auswaehlen
description: Provider verstehen, konfigurieren und das richtige Modell fuer jede Aufgabe waehlen.
---

# Modell auswaehlen

Obsilo arbeitet mit vielen AI-Providern und Modellen. Diese Seite erklaert, worauf es ankommt, wie du jeden Provider einrichtest und welches Modell fuer welche Aufgabe passt.

## Was ein gutes Modell fuer Obsilo ausmacht

Obsilo ist ein Agent -- er beantwortet nicht nur Fragen, sondern fuehrt Aktionen aus. Das bedeutet, das Modell muss:

- **Tool Use (Function Calling) unterstuetzen** -- das Modell muss Obsilos 55+ Tools aufrufen koennen
- **Anweisungen praezise befolgen** -- der System-Prompt ist komplex, mit Rules, Skills und Mode-Definitionen
- **Mehrstufige Aufgaben planen** -- Dateien lesen, suchen, bearbeiten und verifizieren erfordert Planung

:::tip Nutze die neuesten, leistungsfaehigsten Modelle
Obsilo funktioniert am besten mit starken Frontier-Modellen die bei Tool Use und Reasoning hervorragend sind. Aeltere oder kleinere Modelle koennen bei komplexen Aufgaben scheitern, Genehmigungsschritte ueberspringen oder falsche Tools aufrufen. Das Testing wurde hauptsaechlich mit Anthropic Claude Modellen durchgefuehrt.
:::

Fuer **Hintergrund-Aufgaben** wie Memory-Extraktion, Chat-Titling oder kontextuelle Anreicherung reicht ein leichtgewichtiges und guenstiges Modell -- diese Aufgaben sind einfach und benoetigen keinen Tool Use.

## Provider-Kategorien

Obsilo unterstuetzt drei Kategorien von Providern. Jede hat unterschiedliche Vor- und Nachteile.

### Cloud Provider (API Key)

Du erstellst ein Konto, bekommst einen API Key und zahlst pro Nutzung. Beste Qualitaet und Zuverlaessigkeit.

| Provider | Erste Schritte | Was du bekommst |
|----------|---------------|-----------------|
| **Anthropic** | Konto erstellen bei [console.anthropic.com](https://console.anthropic.com), API Key generieren (beginnt mit `sk-ant-...`) | Zugang zur Claude-Modellfamilie. Bester Tool Use im Testing. |
| **OpenAI** | Konto erstellen bei [platform.openai.com](https://platform.openai.com), API Key generieren (beginnt mit `sk-...`) | Zugang zur GPT-Modellfamilie. Schnell, guter strukturierter Output. |
| **OpenRouter** | Konto erstellen bei [openrouter.ai](https://openrouter.ai), API Key generieren (beginnt mit `sk-or-...`) | Zugang zu 100+ Modellen vieler Provider mit einem einzigen Key. Einige Modelle haben kostenlose Kontingente. |
| **Azure OpenAI** | Enterprise Deployment ueber das Azure Portal | OpenAI-Modelle mit Enterprise Compliance und privaten Endpoints. |

### Gateway Provider (Login-basiert)

Kein API Key noetig -- du meldest dich mit einem bestehenden Konto an. Gut wenn du bereits ein Abo hast.

| Provider | Erste Schritte | Was du bekommst |
|----------|---------------|-----------------|
| **GitHub Copilot** | Klicke "Sign in with GitHub" in der Modell-Konfiguration. Ein Device Code erscheint -- gib ihn bei github.com/login/device ein. Benoetigt ein aktives Copilot-Abo. | Zugang zu mehreren Frontier-Modellen ueber dein bestehendes Copilot-Abo. Kein separater API Key noetig. Nutzt eine inoffizielle API -- Modelle koennen sich aendern. |
| **Kilo Gateway** | Klicke "Sign in" in der Modell-Konfiguration, oder fuege direkt einen API Token ein. | Zentrales Gateway zu mehreren Frontier-Modellen. Organisations-Kontext, dynamische Modellliste, verwalteter Zugang. |

### Lokale Provider (kostenlos, privat)

Modelle laufen auf deinem Rechner. Keine Daten verlassen dein Geraet. Kostenlos, aber benoetigt Hardware (8GB+ RAM empfohlen).

| Provider | Erste Schritte | Was du bekommst |
|----------|---------------|-----------------|
| **Ollama** | Installiere von [ollama.ai](https://ollama.ai). Lade ein Modell: `ollama pull llama3.2`. Der Server startet automatisch unter `http://localhost:11434`. | Viele Open-Source-Modelle. Beste lokale Erfahrung. Achte darauf, ein Modell mit Tool-Use-Unterstuetzung zu waehlen. |
| **LM Studio** | Installiere von [lmstudio.ai](https://lmstudio.ai). Lade ein Modell in der App herunter, starte dann den lokalen Server im Developer-Tab. | Visueller Model Browser, einfaches Setup. Standard-URL: `http://localhost:1234`. |
| **Custom** | Jeder Server mit OpenAI-kompatibler API. Gib die Base URL (mit `/v1` Suffix) und optionalen API Key ein. | Fuer selbst gehostete Inference-Server, Corporate Proxies oder jeden kompatiblen Endpoint. |

## Modell in Obsilo hinzufuegen

1. Oeffne **Settings > Obsilo Agent > Models**
2. Klicke **"+ add model"**
3. Waehle einen **Provider** aus dem Dropdown
4. Folge den Provider-spezifischen Anweisungen:
   - **API-Key-Provider:** Key einfuegen, Modell-ID auswaehlen oder eingeben
   - **GitHub Copilot:** "Sign in with GitHub" klicken, Device Flow abschliessen
   - **Kilo Gateway:** "Sign in" klicken oder Token einfuegen
   - **Lokale Provider:** Base URL eingeben, "Browse installed models" klicken
5. Optional: **Anzeigename** setzen, **Temperature** und **Max Tokens** anpassen
6. **Add** klicken

:::info Quick Pick
Bei API-Key-Providern zeigt das "Quick pick" Dropdown beliebte Modelle mit vorausgefuellten IDs. Bei Ollama und LM Studio ruft der "Browse"-Button ab, was auf deinem lokalen Server laeuft.
:::

## Verschiedene Modelle fuer verschiedene Aufgaben

Du musst nicht ueberall dasselbe Modell verwenden. Obsilo unterstuetzt:

- **Pro-Mode-Modelle:** Unter Settings > Modes kann jeder Mode das Standardmodell ueberschreiben. Nutze ein starkes Modell fuer Agent-Mode und ein guenstigeres fuer Ask-Mode.
- **Memory-Modell:** Unter Settings > Memory waehlst du ein kleines/guenstiges Modell fuer Hintergrund-Extraktion.
- **Chat-Titling-Modell:** Unter Settings > Interface > Chat Linking waehlst du ein kleines Modell fuer Gespraechstitel.
- **Kontextuelles Retrieval-Modell:** Unter Settings > Embeddings waehlst du ein guenstiges Modell fuer die Anreicherung von Such-Chunks im Hintergrund.

Ein gaengiges Setup: ein starkes Frontier-Modell fuer interaktive Arbeit und ein leichtgewichtiges fuer alle Hintergrund-Aufgaben.

## Embedding-Modelle

Die semantische Suche benoetigt ein separates **Embedding-Modell** -- ein spezialisiertes Modell das Text in mathematische Darstellungen fuer Aehnlichkeitssuche umwandelt.

Konfiguriere es unter **Settings > Embeddings > add embedding model**. Optionen:
- Jeder OpenAI-kompatible Embedding-Endpoint
- Lokale Embedding-Modelle ueber Ollama (z.B. `nomic-embed-text`)
- GitHub Copilot und Kilo Gateway unterstuetzen ebenfalls Embedding-Modelle

Das Embedding-Modell beeinflusst nur die Suchqualitaet -- nicht die Chat-Antworten.

## Kostenuebersicht

| Ansatz | Monatliche Kosten | Hinweise |
|--------|--------------------|----------|
| Nur lokal (Ollama/LM Studio) | Kostenlos | Benoetigt leistungsfaehige Hardware. Qualitaet abhaengig von Modellgroesse. |
| Kostenlose Kontingente (OpenRouter, Google) | Kostenlos | Rate-limitiert. Gut fuer gelegentliche Nutzung. |
| GitHub Copilot | Im Abo enthalten | Keine Zusatzkosten wenn du bereits Copilot zahlst. |
| Cloud API (leichte Nutzung) | $5--15 | Einige Gespraeche pro Tag. |
| Cloud API (intensive Nutzung) | $20--50+ | Taeglicher Power User mit komplexen Aufgaben. |

## Naechste Schritte

- [Chat-Oberflaeche](/de/guide/working-with-obsilo/chat-interface) -- Alle Chat-Funktionen im Detail
- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche einrichten (braucht ein Embedding-Modell)
- [Provider-Referenz](/de/guide/reference/providers) -- Detaillierte Einrichtungsanleitungen pro Provider
