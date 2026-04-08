---
name: vault-health-batch
description: Autonomer Batch-Modus fuer Vault Health Findings. Arbeitet Orphans, Missing Backlinks und Tags in Batches ab ohne bei jedem Fix zu fragen.
trigger: vault-health-batch|findings.*autonom|batch.*health|health.*batch|vault health.*\d+ findings
source: bundled
requiredTools: [vault_health_check, update_frontmatter, write_file, read_file, semantic_search]
---

# Vault Health Batch Mode

Du arbeitest Vault-Health-Findings AUTONOM in Batches ab.
Frage den User NUR bei echten Entscheidungen, NICHT bei jedem einzelnen Fix.
Alle Aenderungen sind per Undo-Bar reversibel (Checkpoints werden automatisch erstellt).

## Phase 1: TRIAGE

1. Rufe `vault_health_check` auf
2. Lies die Findings und gruppiere nach Typ
3. Gib dem User eine kurze Uebersicht (3-5 Zeilen):
   ```
   Vault Health: X Findings
   - N Orphaned Notes (davon M mit Kontext)
   - N Missing Backlinks
   - N Broken Links
   - N Inconsistent Tags
   - N Weak Clusters
   
   Ich starte mit den mechanischen Fixes (Backlinks, Tags).
   Bei Broken Links und isolierten Orphans frage ich dich.
   ```
4. Starte SOFORT mit Phase 2 -- warte NICHT auf Bestaetigung

## Phase 2: BATCH-FIX

Arbeite die Typen in dieser Reihenfolge ab. Pro Typ: Batch von 10 Fixes, dann eine Statuszeile.

### 2a: Missing Backlinks (AUTONOM)

Das sind Entitaeten die von anderen Notes via MOC-Properties referenziert werden aber nicht zurueckverlinken.

Vorgehen:
1. Die Finding-Daten zeigen: `[[Target]] -- N incoming link(s) without backlink`
2. Lies die Target-Note mit `read_file`
3. Pruefe welche MOC-Property passend ist (Notizen, Konzepte, Themen etc.)
4. Setze den Backlink via `update_frontmatter` auf der Target-Note
5. KEIN Fragen -- das ist ein mechanischer Fix

Statusmeldung nach jedem Batch: `[10/25] Missing Backlinks gefixt.`

### 2b: Orphaned Notes MIT Kontext (AUTONOM)

Das sind Notes die ausgehende MOC-Links haben (sie verlinken AUF Themen/Konzepte) aber von nichts zurueckverlinkt werden.

Vorgehen:
1. Die Finding-Daten zeigen: `Note X (links to: Themen: [[Thema Y]])`
2. Das bedeutet: Note X gehoert zu Thema Y, aber Thema Y listet Note X nicht
3. Lies die Thema-Y-Note mit `read_file`
4. Ergaenze den Backlink via `update_frontmatter` auf Thema Y (z.B. `Notizen: [[Note X]]`)
5. KEIN Fragen -- der Kontext ist klar

WICHTIG: Nutze IMMER die BESTEHENDE Entitaet. Erstelle KEINE neuen Themen oder Konzepte.

Statusmeldung nach jedem Batch: `[30/197] Orphan-Backlinks eingetragen.`

### 2c: Inconsistent Tags (AUTONOM)

Tags die sich nur in Gross-/Kleinschreibung unterscheiden.

Vorgehen:
1. Waehle die haeufigere Variante
2. Aendere alle Vorkommen der selteneren Variante via `update_frontmatter`
3. KEIN Fragen

### 2d: Broken Links (USER-ENTSCHEIDUNG)

Links die auf nicht-existierende Notes zeigen.

Vorgehen:
1. Zeige ALLE Broken Links gesammelt (nicht einzeln)
2. STOPP -- frage den User:
   ```
   N Broken Links gefunden:
   - [[Note A]] (referenziert von 3 Notes)
   - [[Note B]] (referenziert von 1 Note)
   
   Optionen:
   a) Stub-Notes erstellen (mit Basis-Inhalt)
   b) Links entfernen
   c) Einzeln entscheiden
   d) Ueberspringen
   ```
3. Erst nach Antwort weitermachen

### 2e: Orphaned Notes OHNE Kontext (USER-ENTSCHEIDUNG)

Komplett isolierte Notes ohne jegliche MOC-Links.

Vorgehen:
1. Zeige die ersten 10 isolierten Notes
2. STOPP -- frage den User:
   ```
   N isolierte Notes (keine MOC-Properties, keine eingehenden Links):
   - Note A
   - Note B
   - ...
   
   Soll ich per semantic_search passende Themen finden und vorschlagen?
   Oder sollen diese Notes ignoriert werden?
   ```
3. Wenn ja: Fuer jede Note semantic_search, Thema vorschlagen, update_frontmatter

### 2f: Weak Clusters (NUR TOP-5)

Semantisch aehnliche Notes ohne explizite Links.

Vorgehen:
1. Nur die Top-5 Paare (hoechste Similarity)
2. Lies beide Notes mit `read_file`
3. Schlage dem User vor: "Soll ich [[A]] und [[B]] verlinken?"
4. Warte auf Bestaetigung

## Phase 3: ABSCHLUSS

Gib eine kompakte Zusammenfassung:
```
Vault Health Batch abgeschlossen:
- X Missing Backlinks gefixt
- Y Orphan-Backlinks eingetragen
- Z Tags vereinheitlicht
- N Broken Links: [Status]
- M isolierte Orphans: [Status]

Alle Aenderungen sind per Undo-Bar (oben im Chat) reversibel.
```

## Token-Effizienz-Regeln (STRIKT einhalten)

1. KEIN `read_file` fuer Orphans wenn die Finding-Daten den Kontext liefern
2. KEIN `semantic_search` fuer Notes die bereits MOC-Links haben
3. Arbeite in Batches von 10 gleichartigen Fixes
4. Nach 20 Iterationen: Zusammenfassung geben und fragen "Weiter?"
5. IGNORIERE die Fix Rules im vault_health_check Output -- befolge DIESE Regeln

## Autonomie-Regeln (STRIKT einhalten)

AUTONOM (KEIN Fragen):
- Backlink-Eintragungen (Missing Backlinks, Orphans mit Kontext)
- Tag-Vereinheitlichung

MIT USER-ENTSCHEIDUNG (IMMER Fragen):
- Broken Links (erstellen vs. entfernen)
- Orphans ohne Kontext (einordnen vs. ignorieren)
- Weak Clusters (verlinken ja/nein)
- Neue Entitaeten erstellen (Themen, Konzepte)
