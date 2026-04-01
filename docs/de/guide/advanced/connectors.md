---
title: Connectors
description: MCP-Client für externe Tools, MCP-Server für Claude Desktop und Remote-Zugriff.
---

# Connectors

Obsilo kann sich mit externen Tools verbinden, deinen Vault für andere KI-Anwendungen bereitstellen und sogar Remote-Zugriff von überall ermöglichen. Möglich wird das durch das Model Context Protocol (MCP) und ein Cloudflare-Relay.

## MCP-Client -- Externe Tools anbinden

Der MCP-Client ermöglicht es Obsilo, Tools von externen MCP-Servern zu nutzen. So kannst du die Fähigkeiten des Agents erweitern, ohne Plugins zu schreiben.

### Was du anbinden kannst

Jeder MCP-kompatible Server funktioniert. Typische Beispiele:
- **Datenbank-Tools** -- SQLite, PostgreSQL oder andere Datenbanken abfragen
- **Webdienste** -- mit APIs interagieren, Daten abrufen
- **Lokale Tools** -- Dateisystem-Dienstprogramme, Shell-Befehle, eigene Skripte
- **Drittanbieter-Integrationen** -- GitHub, Slack, Kalenderdienste

### Einrichtung

1. Öffne **Settings > Obsilo Agent > MCP**
2. Klicke auf **"+ Add Server"**
3. Wähle den Transport-Typ:

| Transport | Wann verwenden |
|-----------|---------------|
| **stdio** | Lokale Server, die als Kommandozeilenprozesse laufen |
| **SSE** | Remote-Server mit Server-Sent Events (Legacy) |
| **Streamable HTTP** | Moderne Remote-Server (empfohlen für Remote) |

4. Gib den Server-Befehl oder die URL ein
5. Speichern -- der Agent erkennt verfügbare Tools automatisch

Sobald verbunden, kann der Agent externe Tools über `use_mcp_tool` aufrufen und Server mit `manage_mcp_server` verwalten.

:::tip Automatische Erkennung
Du musst dem Agent nicht mitteilen, welche Tools verfügbar sind. Er liest die Tool-Liste von jedem verbundenen MCP-Server und nutzt sie, wenn sie zu deiner Anfrage passen.
:::

## MCP-Server -- Deinen Vault für Claude Desktop bereitstellen

Das ist eine der einzigartigsten Funktionen von Obsilo. Du kannst Obsilo zum MCP-Server machen, sodass Claude Desktop (oder jeder andere MCP-Client) deinen Obsidian-Vault lesen und beschreiben kann.

### Warum das wichtig ist

Ohne Obsilo hat Claude Desktop keine Möglichkeit, auf deine Obsidian-Notizen zuzugreifen. Mit aktiviertem MCP-Server erhält Claude Desktop strukturierten Zugriff auf deinen Vault -- Suchen, Lesen und sogar Schreiben von Notizen über eine kontrollierte Schnittstelle.

### Verfügbare Tools (3 Stufen)

| Stufe | Tools | Was sie tun |
|-------|-------|------------|
| **Read** | `read_notes`, `search_vault`, `get_context` | Vault-Inhalt suchen und lesen |
| **Session** | `sync_session`, `update_memory` | Konversationskontext und Gedächtnis synchronisieren |
| **Write** | `write_vault` | Notizen im Vault erstellen und ändern |

### Einrichtung

1. Öffne **Settings > Obsilo Agent > MCP > Server**-Tab
2. Aktiviere den MCP-Server
3. Klicke auf **"Configure Claude Desktop"** -- das fügt die Konfiguration automatisch zur Config-Datei von Claude Desktop hinzu
4. Starte Claude Desktop neu

Das war's. Claude Desktop sieht deinen Vault jetzt als verfügbare Tool-Quelle.

:::warning Schreibzugriff
Die Write-Stufe erlaubt Claude Desktop, deinen Vault zu verändern. Aktiviere sie nur, wenn du den Prompts vertraust, die du über Claude Desktop sendest. Die Read- und Session-Stufen sind für den täglichen Gebrauch unbedenklich.
:::

## Remote-Zugriff -- Cloudflare-Relay

Remote-Zugriff ermöglicht dir, von überall mit deinem Vault zu interagieren -- auch wenn du nicht an deinem Computer bist, solange Obsidian läuft.

### So funktioniert es

Ein Cloudflare Workers-Relay fungiert als Brücke zwischen deiner lokalen Obsilo-Instanz und entfernten Clients. Der RelayClient in Obsilo hält eine persistente Verbindung zum deployten Worker.

### Einrichtung

1. Deploye den Cloudflare Worker (siehe die Relay-Deployment-Anleitung)
2. Trage unter **Settings > Obsilo Agent > MCP > Remote** deine Worker-URL ein
3. Authentifiziere dich mit dem bereitgestellten Token
4. Das Relay verbindet sich automatisch, sobald Obsidian läuft

:::info Obsidian muss laufen
Remote-Zugriff erfordert, dass Obsidian auf deinem Rechner läuft. Das Relay leitet Anfragen an deine lokale Instanz weiter -- es speichert keine Vault-Daten in der Cloud.
:::

## Provider-Überblick

Obsilo unterstützt über 10 KI-Provider. Die meisten verwenden einen einfachen API-Key, aber zwei bieten alternative Authentifizierung:

| Provider | Authentifizierung | Hinweise |
|----------|------------------|----------|
| **GitHub Copilot** | OAuth Device Flow | Nutzt dein bestehendes GitHub Copilot-Abo. Kein separater API-Key nötig -- du meldest dich mit deinem GitHub-Konto an. |
| **Kilo Gateway** | Device Auth + manueller Token | Community-Gateway mit geteilten Rate Limits. Device-Authentifizierung oder Token manuell einfügen. |
| **Anthropic, OpenAI, Google etc.** | API-Key | Key unter Settings > Models einfügen. Standard-Einrichtung. |

### GitHub Copilot einrichten

1. Öffne **Settings > Obsilo Agent > Models > + Add Model**
2. Wähle **GitHub Copilot** als Provider
3. Klicke auf **"Sign in with GitHub"** -- ein Device-Code erscheint
4. Öffne die GitHub-URL, gib den Code ein und autorisiere
5. Wähle ein Modell (Claude oder GPT über Copilot)

### Kilo Gateway einrichten

1. Wähle **Kilo Gateway** als Provider
2. Wähle **Device Auth** (empfohlen) oder **Manual Token**
3. Für Device Auth: folge dem angezeigten Ablauf zur Authentifizierung
4. Für Manual Token: füge deinen Token vom Kilo-Dashboard ein

:::tip Kostenloser Zugang
GitHub Copilot funktioniert, wenn du bereits ein Copilot-Abo hast. Kilo Gateway bietet Community-Zugang mit geteilten Limits. Beides sind gute Optionen, wenn du Obsilo ohne separaten API-Key ausprobieren möchtest.
:::

## Nächste Schritte

- [Skills, Regeln & Workflows](/de/guide/advanced/skills-rules-workflows) -- Passe das Verhalten des Agents an
- [Office-Dokumente](/de/guide/advanced/office-documents) -- Erstelle Präsentationen und Dokumente
- [Multi-Agent & Tasks](/de/guide/advanced/multi-agent) -- Delegiere Arbeit an Sub-Agents
