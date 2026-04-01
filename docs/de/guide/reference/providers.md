---
title: Provider & Modelle
description: Einrichtungsanleitungen für alle unterstützten KI-Provider -- Anthropic, OpenAI, Copilot, Kilo, Ollama und mehr.
---

# Provider & Modelle

Obsilo unterstützt 10 KI-Provider. Diese Seite führt dich durch die Einrichtung jedes einzelnen.

Für alle Provider: Öffne **Settings > Obsilo Agent > Models**, klicke auf **"+ add model"** und wähle deinen Provider.

## Cloud-Provider

### Anthropic

| | |
|---|---|
| **Was du brauchst** | API-Key von [console.anthropic.com](https://console.anthropic.com) |
| **Empfohlene Modelle** | Claude Sonnet 4.6 (bestes Gesamtpaket), Claude Haiku (schnell und günstig) |
| **Embedding** | Nativ nicht verfügbar -- nutze OpenAI für Embeddings |

**Einrichtung:**
1. Erstelle ein Konto auf [console.anthropic.com](https://console.anthropic.com)
2. Gehe zu **API Keys** und erstelle einen neuen Key
3. Wähle in Obsilo **Anthropic** als Provider, füge den Key ein und wähle ein Modell

:::tip Beste Tool-Nutzung
Anthropic-Modelle sind durchgehend die besten im korrekten Umgang mit Obsilos Tools. Wenn Qualität deine Priorität ist, starte hier.
:::

### OpenAI

| | |
|---|---|
| **Was du brauchst** | API-Key von [platform.openai.com](https://platform.openai.com) |
| **Empfohlene Modelle** | GPT-4o (ausgewogen), o3 (Reasoning), GPT-4o-mini (Budget) |
| **Embedding** | Nativ unterstützt -- `text-embedding-3-small` empfohlen |

**Einrichtung:**
1. Erstelle ein Konto auf [platform.openai.com](https://platform.openai.com)
2. Gehe zu **API Keys** und generiere einen neuen Key
3. Wähle in Obsilo **OpenAI** als Provider, füge den Key ein und wähle ein Modell

:::info Embedding-Modelle
Ein OpenAI-Key gibt dir auch Zugang zu Embedding-Modellen für Semantic Search. Konfiguriere unter **Settings > Embeddings**.
:::

### OpenRouter

| | |
|---|---|
| **Was du brauchst** | API-Key von [openrouter.ai](https://openrouter.ai) |
| **Empfohlene Modelle** | Beliebig -- OpenRouter bietet Zugang zu über 100 Modellen verschiedener Provider |
| **Embedding** | Nicht verfügbar |

**Einrichtung:**
1. Erstelle ein Konto auf [openrouter.ai](https://openrouter.ai)
2. Gehe zu **Keys** und erstelle einen neuen API-Key
3. Wähle in Obsilo **OpenRouter** als Provider und füge den Key ein
4. Durchsuche oder tippe eine beliebige Modell-ID (z.B. `anthropic/claude-sonnet-4.6`, `google/gemini-2.5-pro`)

### Azure OpenAI

| | |
|---|---|
| **Was du brauchst** | Azure-Abonnement, ein deploytes Modell, API-Key und Endpoint-URL |
| **Empfohlene Modelle** | GPT-4o (deployt in deiner Azure-Region) |
| **Embedding** | Nativ unterstützt über deploytes Embedding-Modell |

**Einrichtung:**
1. Deploye ein Modell in deiner Azure OpenAI-Ressource
2. Kopiere die **Endpoint-URL**, den **API-Key** und den **Deployment-Namen**
3. Wähle in Obsilo **Azure OpenAI** als Provider und fülle alle drei Felder aus

:::info Enterprise-Einsatz
Azure OpenAI ist ideal für Organisationen mit Compliance-Anforderungen. Daten bleiben innerhalb deines Azure-Tenants.
:::

## Gateway-Provider

### GitHub Copilot

| | |
|---|---|
| **Was du brauchst** | Ein aktives GitHub Copilot-Abonnement (Individual, Business oder Enterprise) |
| **Empfohlene Modelle** | GPT-4o, Claude Sonnet (verfügbar über Copilot) |
| **Embedding** | Nicht verfügbar |

**Einrichtung (OAuth Device Flow):**
1. Wähle in Obsilo **GitHub Copilot** als Provider
2. Klicke auf **"Sign in with GitHub"** -- ein Device-Code erscheint
3. Öffne [github.com/login/device](https://github.com/login/device) im Browser
4. Gib den Code ein und autorisiere die App
5. Obsilo erkennt deine verfügbaren Modelle automatisch

:::tip Keine Zusatzkosten
Wenn du bereits für GitHub Copilot bezahlst, kostet das nichts extra. Die Modelle sind in deinem Abonnement enthalten.
:::

### Kilo Gateway

| | |
|---|---|
| **Was du brauchst** | Ein Kilo Code-Konto mit Gateway-Zugang |
| **Empfohlene Modelle** | Abhängig von den verfügbaren Modellen deiner Organisation |
| **Embedding** | Nicht verfügbar |

**Einrichtung (Device Auth -- empfohlen):**
1. Wähle in Obsilo **Kilo Gateway** als Provider
2. Klicke auf **"Sign in"** -- ein Device-Code und eine URL erscheinen
3. Öffne die URL im Browser, gib den Code ein und autorisiere
4. Modelle werden dynamisch aus deiner Organisation geladen

**Einrichtung (Manual Token):**
1. Erhalte einen Gateway-Token von deinem Kilo Code-Admin
2. Wähle in Obsilo **Kilo Gateway** und dann **"Manual Token"**
3. Füge den Token ein -- Modelle werden automatisch geladen

## Lokale Provider

### Ollama

| | |
|---|---|
| **Was du brauchst** | Ollama auf deinem Rechner installiert |
| **Empfohlene Modelle** | Qwen 2.5 7B (ausgewogen), Llama 3.2 (universell), Codestral (Code) |
| **Embedding** | Unterstützt über `nomic-embed-text` oder ähnliche |

**Einrichtung:**
1. Installiere Ollama von [ollama.ai](https://ollama.ai)
2. Lade ein Modell herunter: `ollama pull qwen2.5:7b`
3. Wähle in Obsilo **Ollama** als Provider -- kein API-Key nötig
4. Die Modellliste erkennt laufende Modelle automatisch

:::tip Datenschutz
Mit Ollama verlassen keine Daten deinen Rechner. Perfekt für sensible Vaults.
:::

### LM Studio

| | |
|---|---|
| **Was du brauchst** | LM Studio installiert mit einem geladenen Modell |
| **Empfohlene Modelle** | Jedes GGUF-Modell -- durchsuche den eingebauten Katalog |
| **Embedding** | Unterstützt für kompatible Modelle |

**Einrichtung:**
1. Installiere LM Studio von [lmstudio.ai](https://lmstudio.ai)
2. Lade ein Modell aus dem Katalog herunter und aktiviere es
3. Starte den **lokalen Server** (LM Studio > Developer-Tab)
4. Wähle in Obsilo **LM Studio** als Provider -- kein API-Key nötig

### Custom Endpoint

| | |
|---|---|
| **Was du brauchst** | Einen beliebigen OpenAI-kompatiblen API-Endpunkt |
| **Empfohlene Modelle** | Abhängig vom Server |
| **Embedding** | Abhängig vom Server |

**Einrichtung:**
1. Wähle in Obsilo **Custom** als Provider
2. Gib die **Base-URL** ein (z.B. `http://localhost:8080/v1`)
3. Gib einen **API-Key** ein, falls dein Server einen benötigt
4. Tippe den **Modellnamen** exakt so, wie der Server ihn erwartet

Das funktioniert mit jedem Server, der die OpenAI Chat Completions-API implementiert, einschließlich vLLM, text-generation-inference, LocalAI und selbst gehosteten Endpunkten.

## Provider-Vergleich

| Provider | Auth | Kosten | Datenschutz | Embedding | Am besten für |
|----------|------|--------|-------------|-----------|---------------|
| Anthropic | API-Key | Pay-per-use | Cloud | Nein | Beste Qualität |
| OpenAI | API-Key | Pay-per-use | Cloud | Ja | Strukturierter Output, Embeddings |
| OpenRouter | API-Key | Pay-per-use | Cloud | Nein | Modellvielfalt |
| Azure OpenAI | API-Key + Endpoint | Enterprise | Enterprise-Tenant | Ja | Compliance |
| GitHub Copilot | OAuth | Abonnement | Cloud | Nein | Bestehende Abonnenten |
| Kilo Gateway | Device Auth / Token | Organisation | Cloud | Nein | Team-Deployments |
| Ollama | Keine | Kostenlos | Vollständig lokal | Ja | Datenschutz, Offline |
| LM Studio | Keine | Kostenlos | Vollständig lokal | Ja | Visueller Modell-Browser |
| Custom | Variiert | Variiert | Variiert | Variiert | Selbst gehostete Setups |
