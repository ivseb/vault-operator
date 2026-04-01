---
title: Fehlerbehebung
description: Häufige Probleme und ihre Lösungen.
---

# Fehlerbehebung

Lösungen für die häufigsten Obsilo-Probleme. Wenn dein Problem hier nicht aufgeführt ist, prüfe den **Debug**-Tab in den Einstellungen oder frage im Community-Forum.

## Probleme mit der Modellverbindung

**Symptom:** "Connection failed" oder "API key invalid" beim Testen eines Modells.

| Ursache | Lösung |
|---------|--------|
| Falscher API-Key | Überprüfe den Key unter **Settings > Models**. Generiere ihn auf der Provider-Website neu, wenn du unsicher bist. |
| Abgelaufener Key | Manche Provider lassen Keys nach Inaktivität ablaufen. Generiere einen neuen. |
| Falsche Base-URL | Für Azure und Custom Endpoints prüfe die vollständige URL inklusive `/v1`, falls erforderlich. |
| Rate-limitiert | Warte einige Minuten und versuche es erneut. Erwäge, ein Rate Limit unter **Settings > Loop** zu setzen. |
| Firewall oder Proxy | Obsidian nutzt Electrons Netzwerk-Stack. Stelle sicher, dass deine Firewall ausgehende HTTPS-Verbindungen zulässt. |

:::tip Test-Button
Nutze immer den **Test connection**-Button nach dem Hinzufügen oder Ändern eines Modells. Er überprüft Key, Endpunkt und Modellname in einem Schritt.
:::

## Semantic Search funktioniert nicht

**Symptom:** `semantic_search` liefert keine Ergebnisse, oder der Agent sagt, der Index sei nicht verfügbar.

| Ursache | Lösung |
|---------|--------|
| Kein Embedding-Modell konfiguriert | Gehe zu **Settings > Embeddings** und richte ein Embedding-Modell ein (z.B. OpenAI `text-embedding-3-small`). |
| Index nicht aufgebaut | Klicke auf **Rebuild index** unter **Settings > Embeddings**. Der erste Aufbau kann bei großen Vaults einige Minuten dauern. |
| Embedding-API-Key fehlt | Das Embedding-Modell benötigt möglicherweise einen eigenen API-Key. Prüfe die Embedding-Einstellungen. |
| Auto-index deaktiviert | Wenn Auto-index aus ist, werden neue oder geänderte Notizen nicht indiziert. Aktiviere es oder baue manuell neu auf. |
| Vault zu groß | Bei Vaults mit über 10.000 Notizen kann der erste Aufbau eine Weile dauern. Lass ihn abschließen, bevor du suchst. |

## Agent hängt in einer Schleife

**Symptom:** Der Agent ruft wiederholt Tools auf, ohne Fortschritt zu machen, oder erreicht das Iterationslimit.

| Ursache | Lösung |
|---------|--------|
| Schwaches Modell | Kleinere oder ältere Modelle wiederholen sich manchmal. Wechsle zu einem stärkeren Modell (Claude Sonnet, GPT-4o). |
| Consecutive Error Limit zu hoch | Senke es unter **Settings > Loop > Consecutive error limit** (Standard: 3). |
| Max Iterations zu hoch | Setze eine vernünftige Obergrenze unter **Settings > Loop > Max iterations** (Standard: 25). |
| Tool-Genehmigung wiederholt verweigert | Der Agent fragt um Genehmigung, aber du hast nicht reagiert. Genehmige oder verweigere, damit er weitermachen kann. |
| Context Overflow | Aktiviere **Context condensing** unter **Settings > Loop**. Senke den Condensing-Schwellenwert, falls du 400-Fehler siehst. |

:::info Notstopp
Klicke jederzeit auf den **Stop**-Button in der Chat-Toolbar, um den Agent sofort anzuhalten. Bereits vorgenommene Änderungen können über das Checkpoint-System rückgängig gemacht werden.
:::

## Berechtigungsprobleme

**Symptom:** Der Agent sagt, er könne eine Aktion nicht ausführen, oder Genehmigungsanfragen erscheinen bei Routineaufgaben.

| Ursache | Lösung |
|---------|--------|
| Auto-Approve nicht aktiviert | Gehe zu **Settings > Permissions** und aktiviere Auto-Approve für Kategorien, denen du vertraust. |
| Datei steht auf der Ignorierliste | Prüfe `.obsidian-agentignore` im Vault-Root. Entferne den Pfad, wenn der Agent darauf zugreifen soll. |
| Datei ist geschützt | Prüfe `.obsidian-agentprotected`. Der Agent kann diese Dateien lesen, aber nicht schreiben. |
| Modus schränkt Tools ein | Der aktuelle Modus enthält möglicherweise nicht die benötigte Tool-Gruppe. Wechsle zum Agent-Modus oder bearbeite die Tools des Modus. |

## MCP-Server verbindet sich nicht

**Symptom:** "Failed to connect" oder "Server unreachable" beim Hinzufügen oder Nutzen eines MCP-Servers.

| Ursache | Lösung |
|---------|--------|
| Falscher Transport-Typ | Nur **SSE** und **Streamable HTTP** werden unterstützt. Stdio funktioniert nicht in Obsidians Electron-Runtime. |
| Server läuft nicht | Stelle sicher, dass der MCP-Server läuft und unter der konfigurierten URL erreichbar ist. |
| Falsche URL | Prüfe die Server-URL. Gängiges Format: `http://localhost:3000/sse` oder `http://localhost:3000/mcp`. |
| CORS-Probleme | Wenn der MCP-Server lokal läuft, benötigt er möglicherweise CORS-Header. Prüfe die Dokumentation des Servers. |
| Netzwerk-Timeout | Erhöhe den Verbindungs-Timeout in den MCP-Server-Einstellungen, oder prüfe dein Netzwerk. |

## Leistungsprobleme

**Symptom:** Obsidian fühlt sich langsam an, der Agent braucht lange, oder die Oberfläche ruckelt.

| Ursache | Lösung |
|---------|--------|
| Großes Vault wird indiziert | Der Aufbau des semantischen Index läuft im Hintergrund. Warte, bis er abgeschlossen ist. |
| Zu viele gleichzeitige Sub-Agents | Begrenze die Subtask-Tiefe unter **Settings > Loop** (Standard: 2). |
| Großes Kontextfenster | Aktiviere Context Condensing, damit die Konversation nicht zu umfangreich wird. |
| Viele MCP-Server | Jeder verbundene Server hält eine aktive Verbindung. Entferne ungenutzte Server. |
| Langsames Modell | Lokale Modelle auf begrenzter Hardware können langsam sein. Probiere ein kleineres Modell oder nutze einen Cloud-Provider. |

## Memory extrahiert nicht

**Symptom:** Der Agent erinnert sich nicht an Dinge aus früheren Konversationen.

| Ursache | Lösung |
|---------|--------|
| Memory-Extraktion deaktiviert | Aktiviere sie unter **Settings > Memory > Memory extraction**. |
| Chat History deaktiviert | Memory-Extraktion erfordert gespeicherte Konversationen. Aktiviere zuerst **Chat history**. |
| Schwellenwert zu hoch | Senke den **Memory threshold** in den Einstellungen (Standard: 0,7). Ein Wert von 0,5 erfasst mehr Erinnerungen. |
| Falsches Memory-Modell | Wenn das Memory-Modell nicht konfiguriert oder offline ist, scheitert die Extraktion stillschweigend. Prüfe **Settings > Memory > Memory model**. |
| Kurze Konversationen | Sehr kurze Gespräche enthalten möglicherweise keine extrahierbaren Fakten. Das ist normal. |

## Häufige Fehlermeldungen

| Fehler | Bedeutung | Behebung |
|--------|-----------|----------|
| `400: context_length_exceeded` | Die Konversation ist zu lang für das Kontextfenster des Modells. | Context Condensing aktivieren. Einen neuen Chat für frischen Kontext starten. |
| `401: Unauthorized` | Ungültiger oder abgelaufener API-Key. | Key unter Settings > Models neu eingeben. |
| `429: Rate limit exceeded` | Zu viele API-Aufrufe in kurzer Zeit. | Rate Limit unter Settings > Loop setzen, oder warten und erneut versuchen. |
| `ECONNREFUSED` | Lokaler Server (Ollama, LM Studio) läuft nicht. | Den lokalen Server starten und erneut versuchen. |
| `Checkpoint failed` | Konnte keinen Datei-Snapshot vor der Bearbeitung erstellen. | Speicherplatz prüfen. Snapshot-Timeout unter Settings > Vault erhöhen. |

:::tip Debug-Tab
Der **Debug**-Tab in den Einstellungen zeigt den internen Ring-Buffer des Agents (letzte 100 Log-Einträge), den generierten System-Prompt und den Verbindungsstatus aller Provider. Starte hier, wenn du unerwartetes Verhalten untersuchst.
:::
