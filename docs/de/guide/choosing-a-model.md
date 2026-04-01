---
title: Modell auswählen
description: Provider und Modelle vergleichen -- finde die beste Kombination für deinen Workflow und dein Budget.
---

# Modell auswählen

Obsilo arbeitet mit jedem LLM-Provider. Die richtige Wahl hängt von deinen Prioritäten ab: Qualität, Geschwindigkeit, Privatsphäre oder Kosten.

## Schnellempfehlung

| Priorität | Provider | Modell | Warum |
|-----------|----------|--------|-------|
| Beste Qualität | Anthropic | Claude Sonnet 4.6 | Bester Tool-Einsatz, befolgt Anweisungen präzise |
| Bestes kostenloses | Google | Gemini 2.5 Flash | Kostenlos, schnell, großer Kontext |
| Bestes lokales | Ollama | Qwen 2.5 7B | Läuft auf deinem Rechner, keine Daten gehen raus |
| Meiste Modelle | OpenRouter | Beliebig | Zugriff auf 100+ Modelle mit einem Key |
| Copilot vorhanden | GitHub Copilot | GPT-4o / Claude | Nutze dein bestehendes Abo |

## Unterstützte Provider

### Cloud Provider (API Key erforderlich)

| Provider | Einrichtung | Modelle | Embedding | Hinweise |
|----------|-------------|---------|-----------|----------|
| **Anthropic** | API Key von [console.anthropic.com](https://console.anthropic.com) | Claude-Familie | Über OpenAI Key | Beste Gesamtqualität |
| **OpenAI** | API Key von [platform.openai.com](https://platform.openai.com) | GPT-4o, o1, o3 | Nativ | Schnell, guter strukturierter Output |
| **Google** | API Key von [AI Studio](https://aistudio.google.com/app/apikey) | Gemini-Familie | Über OpenAI Key | Kostenloses Kontingent verfügbar |
| **OpenRouter** | Key von [openrouter.ai](https://openrouter.ai) | 100+ Modelle | Nein | Ein Key, viele Modelle |
| **Azure OpenAI** | Enterprise Deployment | GPT-4o | Nativ | Enterprise Compliance |

### Gateway Provider (Login-basiert)

| Provider | Einrichtung | Modelle | Hinweise |
|----------|-------------|---------|----------|
| **GitHub Copilot** | Anmelden mit GitHub-Konto | GPT-4o, Claude, Gemini | Nutzt dein bestehendes Copilot-Abo |
| **Kilo Gateway** | Anmelden mit Kilo-Konto | Mehrere Frontier-Modelle | Organisations-Kontext, dynamische Modellliste |

### Lokale Provider (kostenlos, privat)

| Provider | Einrichtung | Modelle | Hinweise |
|----------|-------------|---------|----------|
| **Ollama** | Installiere von [ollama.ai](https://ollama.ai) | Llama, Qwen, Mistral, ... | Beste lokale Erfahrung |
| **LM Studio** | Installiere von [lmstudio.ai](https://lmstudio.ai) | Jedes GGUF-Modell | Visueller Model Browser |
| **Custom** | Jeder OpenAI-kompatible Endpoint | Abhängig vom Server | Für selbst gehostete Setups |

:::tip Embedding-Modelle
Für die semantische Suche brauchst du zusätzlich zum Chat-Modell ein **Embedding-Modell**. Die günstigste Option ist OpenAIs `text-embedding-3-small` (~$0,02 pro 1M Tokens). Konfiguriere es unter Einstellungen > Embeddings.
:::

## Modell pro Aufgabe

Du kannst **unterschiedliche Modelle pro Mode** konfigurieren. Ein gängiges Setup:

| Mode | Modell | Begründung |
|------|--------|------------|
| Ask | Schnelles/günstiges Modell (Gemini Flash, GPT-4o-mini) | Schnelle Antworten, nur Lesen |
| Agent | Leistungsstarkes Modell (Claude Sonnet, GPT-4o) | Komplexe Aufgaben, Tool-Einsatz |
| Memory Extraction | Kleines Modell (Haiku, GPT-4o-mini) | Hintergrundaufgabe, kosteneffizient |

Konfiguriere Modelle pro Mode unter **Einstellungen > Modes > [Mode-Name] > Model**.

## Kostenübersicht

| Nutzung | Monatliche Kosten | Empfehlung |
|---------|--------------------|------------|
| Leicht (wenige Chats/Tag) | $0-5 | Google Gemini (kostenlos) oder GPT-4o-mini |
| Moderat (tägliche Nutzung) | $5-20 | Claude Sonnet oder GPT-4o |
| Intensiv (Power User) | $20-50+ | Claude Sonnet + lokaler Fallback |
| Keine Kosten | $0 | Ollama oder LM Studio (lokal) |

:::info GitHub Copilot
Wenn du bereits für GitHub Copilot zahlst, kannst du dieses Guthaben in Obsilo nutzen -- kein zusätzlicher API Key nötig. Melde dich an über Einstellungen > Models > Add Model > GitHub Copilot.
:::

## Nächste Schritte

- [Chat Interface](/de/guide/working-with-obsilo/chat-interface) -- Alle Chat-Funktionen im Detail
- [Wissen entdecken](/de/guide/working-with-obsilo/knowledge-discovery) -- Semantische Suche einrichten (braucht ein Embedding-Modell)
- [Provider-Referenz](/de/guide/reference/providers) -- Detaillierte Einrichtungsanleitungen pro Provider
