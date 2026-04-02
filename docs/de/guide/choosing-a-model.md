---
title: Modell auswählen
description: Provider verstehen, konfigurieren und das richtige Modell für jede Aufgabe wählen.
---

# Modell auswählen

Obsilo arbeitet mit vielen AI-Providern und Modellen. Diese Seite erklärt, worauf es ankommt, wie du jeden Provider einrichtest und welches Modell für welche Aufgabe passt.

## Was ein gutes Modell für Obsilo ausmacht

Obsilo ist ein Agent -- er beantwortet nicht nur Fragen, sondern führt Aktionen aus. Das Modell muss:

- **Tool Use (Function Calling) unterstützen** -- das Modell muss Obsilos 55+ Tools aufrufen können
- **Anweisungen präzise befolgen** -- der System-Prompt ist komplex, mit Rules, Skills und Mode-Definitionen
- **Mehrstufige Aufgaben planen** -- Dateien lesen, suchen, bearbeiten und verifizieren erfordert Planung

:::tip Nutze die neuesten, leistungsfähigsten Modelle
Obsilo funktioniert am besten mit starken Frontier-Modellen, die bei Tool Use und Reasoning hervorragend sind. Ältere oder kleinere Modelle können bei komplexen Aufgaben scheitern, Genehmigungsschritte überspringen oder falsche Tools aufrufen. Das Testing wurde hauptsächlich mit Anthropic Claude Modellen durchgeführt.
:::

Für **Hintergrund-Aufgaben** wie Memory-Extraktion, Chat-Titling oder kontextuelle Anreicherung reicht ein leichtgewichtiges und günstiges Modell -- diese Aufgaben sind einfach und benötigen keinen Tool Use.

## Provider-Kategorien

Obsilo unterstützt drei Kategorien von Providern mit unterschiedlichen Vor- und Nachteilen.

### Cloud Provider (API Key)

Du erstellst ein Konto, bekommst einen API Key und zahlst pro Nutzung. Beste Qualität und Zuverlässigkeit.

| Provider | Erste Schritte | Was du bekommst |
|----------|---------------|-----------------|
| **Anthropic** | Konto erstellen bei [console.anthropic.com](https://console.anthropic.com), API Key generieren (beginnt mit `sk-ant-...`) | Zugang zur Claude-Modellfamilie. Bester Tool Use im Testing. |
| **OpenAI** | Konto erstellen bei [platform.openai.com](https://platform.openai.com), API Key generieren (beginnt mit `sk-...`) | Zugang zur GPT-Modellfamilie. Schnell, guter strukturierter Output. |
| **OpenRouter** | Konto erstellen bei [openrouter.ai](https://openrouter.ai), API Key generieren (beginnt mit `sk-or-...`) | Zugang zu 100+ Modellen vieler Provider mit einem einzigen Key. Einige Modelle haben kostenlose Kontingente. |
| **Azure OpenAI** | Enterprise Deployment über das Azure Portal | OpenAI-Modelle mit Enterprise Compliance und privaten Endpoints. |

### Gateway Provider (Login-basiert)

Kein API Key nötig -- du meldest dich mit einem bestehenden Konto an. Praktisch, wenn du bereits ein Abo hast.

| Provider | Erste Schritte | Was du bekommst |
|----------|---------------|-----------------|
| **GitHub Copilot** | Klicke "Sign in with GitHub" in der Modell-Konfiguration. Ein Device Code erscheint -- gib ihn bei github.com/login/device ein. Benötigt ein aktives Copilot-Abo. | Zugang zu mehreren Frontier-Modellen über dein bestehendes Copilot-Abo. Kein separater API Key nötig. Nutzt eine inoffizielle API -- Modelle können sich ändern. |
| **Kilo Gateway** | Klicke "Sign in" in der Modell-Konfiguration, oder füge direkt einen API Token ein. | Zentrales Gateway zu mehreren Frontier-Modellen. Organisations-Kontext, dynamische Modellliste, verwalteter Zugang. |

### Lokale Provider (kostenlos, privat)

Modelle laufen auf deinem Rechner. Keine Daten verlassen dein Gerät. Kostenlos, aber benötigt Hardware (8GB+ RAM empfohlen).

| Provider | Erste Schritte | Was du bekommst |
|----------|---------------|-----------------|
| **Ollama** | Installiere von [ollama.ai](https://ollama.ai). Lade ein Modell: `ollama pull llama3.2`. Der Server startet automatisch unter `http://localhost:11434`. | Viele Open-Source-Modelle. Beste lokale Erfahrung. Achte darauf, ein Modell mit Tool-Use-Unterstützung zu wählen. |
| **LM Studio** | Installiere von [lmstudio.ai](https://lmstudio.ai). Lade ein Modell in der App herunter, starte dann den lokalen Server im Developer-Tab. | Visueller Model Browser, einfaches Setup. Standard-URL: `http://localhost:1234`. |
| **Custom** | Jeder Server mit OpenAI-kompatibler API. Gib die Base URL (mit `/v1` Suffix) und optionalen API Key ein. | Für selbst gehostete Inference-Server, Corporate Proxies oder jeden kompatiblen Endpoint. |

## Modell in Obsilo hinzufügen

1. Öffne **Settings > Obsilo Agent > Models**
2. Klicke **"+ add model"**
3. Wähle einen **Provider** aus dem Dropdown
4. Folge den Provider-spezifischen Anweisungen:
   - **API-Key-Provider:** Key einfügen, Modell-ID auswählen oder eingeben
   - **GitHub Copilot:** "Sign in with GitHub" klicken, Device Flow abschließen
   - **Kilo Gateway:** "Sign in" klicken oder Token einfügen
   - **Lokale Provider:** Base URL eingeben, "Browse installed models" klicken
5. Optional: **Anzeigename** setzen, **Temperature** und **Max Tokens** anpassen
6. **Add** klicken

:::info Quick Pick
Bei API-Key-Providern zeigt das "Quick pick" Dropdown beliebte Modelle mit vorausgefüllten IDs. Bei Ollama und LM Studio ruft der "Browse"-Button ab, was auf deinem lokalen Server läuft.
:::

## Verschiedene Modelle für verschiedene Aufgaben

Du musst nicht überall dasselbe Modell verwenden. Obsilo unterstützt:

- **Pro-Mode-Modelle:** Unter Settings > Modes kann jeder Mode das Standardmodell überschreiben. Nutze ein starkes Modell für Agent-Mode und ein günstigeres für Ask-Mode.
- **Memory-Modell:** Unter Settings > Memory wählst du ein kleines/günstiges Modell für Hintergrund-Extraktion.
- **Chat-Titling-Modell:** Unter Settings > Interface > Chat Linking wählst du ein kleines Modell für Gesprächstitel.
- **Kontextuelles Retrieval-Modell:** Unter Settings > Embeddings wählst du ein günstiges Modell für die Anreicherung von Such-Chunks im Hintergrund.

Ein gängiges Setup: ein starkes Frontier-Modell für interaktive Arbeit und ein leichtgewichtiges für alle Hintergrund-Aufgaben.

## Embedding-Modelle

Die semantische Suche benötigt ein separates **Embedding-Modell** -- ein spezialisiertes Modell, das Text in mathematische Darstellungen für Ähnlichkeitssuche umwandelt.

Konfiguriere es unter **Settings > Embeddings > add embedding model**. Optionen:
- Jeder OpenAI-kompatible Embedding-Endpoint
- Lokale Embedding-Modelle über Ollama (z.B. `nomic-embed-text`)
- GitHub Copilot und Kilo Gateway unterstützen ebenfalls Embedding-Modelle

Das Embedding-Modell beeinflusst nur die Suchqualität -- nicht die Chat-Antworten.

## Kostenübersicht

| Ansatz | Monatliche Kosten | Hinweise |
|--------|--------------------|----------|
| Nur lokal (Ollama/LM Studio) | Kostenlos | Benötigt leistungsfähige Hardware. Qualität abhängig von Modellgröße. |
| Kostenlose Kontingente (OpenRouter, Google) | Kostenlos | Rate-limitiert. Gut für gelegentliche Nutzung. |
| GitHub Copilot | Im Abo enthalten | Keine Zusatzkosten, wenn du bereits Copilot zahlst. |
| Cloud API (leichte Nutzung) | $5--15 | Einige Gespräche pro Tag. |
| Cloud API (intensive Nutzung) | $20--50+ | Täglicher Power User mit komplexen Aufgaben. |

## Nächste Schritte

- [Chat-Oberfläche](/de/guide/working-with-obsilo/chat-interface) -- Alle Chat-Funktionen im Detail
- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche einrichten (braucht ein Embedding-Modell)
- [Provider-Referenz](/de/guide/reference/providers) -- Detaillierte Einrichtungsanleitungen pro Provider
