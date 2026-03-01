# Memory-System: Anleitung

> Dieses Dokument erklaert das zweistufige Memory-System und wie es ueber Projekte hinweg waechst.

---

## Zwei Ebenen

```
Ebene 1: ~/.claude/CLAUDE.md (global)     = WIE wir arbeiten
Ebene 2: memory/MEMORY.md (projekt)       = WORAN wir arbeiten

Global: Einmal einrichten, waechst ueber alle Projekte
Projekt: Pro Projekt, startet mit Template, waechst mit
```

### Ebene 1: Globale Arbeitsweise (~/.claude/CLAUDE.md)

Enthaelt die Arbeitsweise-Patterns (A-H):

| Pattern | Inhalt |
|---------|--------|
| A. Kommunikation | Sprache, Emojis, Commit-Style |
| B. Planung | Plan-Mode Struktur, Phasen |
| C. Feature-Lebenszyklus | Backlog -> Spec -> Plan -> Code -> Update |
| D. Implementierung | Inkrementell, Build+Deploy, Wiring-Pattern |
| E. Debugging | Kausale Ketten, Bug-IDs |
| F. Dokumentation | arc42, ADRs, Feature-Specs |
| G. Git & Release | Dual-Remote, Branch-Flow, Stripping |
| H. Kontinuierliches Lernen | Regeln fuer Memory-Pflege |

**Evolution:** Diese Datei wird NICHT bei jedem neuen Projekt zurueckgesetzt.
`init-scaffold.sh` kopiert sie nur wenn sie noch nicht existiert. Dadurch
wachsen die Patterns ueber alle Projekte hinweg -- wie ein Team das sich
immer besser einspielt.

### Ebene 2: Projekt-Memory (memory/MEMORY.md)

Enthaelt projektspezifisches Wissen:

| Inhalt | Beispiel |
|--------|----------|
| Projekt-Beschreibung | "Obsidian Plugin fuer AI-gesteuerte Vault-Verwaltung" |
| Current State | Phase D abgeschlossen, 30+ Tools |
| Key Architecture | Constructor-Signaturen, Interface-Shapes |
| Coding Rules | "requestUrl statt fetch", "console.debug statt .log" |
| Tech Stack | TypeScript, Obsidian API, esbuild |
| Deploy | /path/to/.obsidian/plugins/plugin-name/ |

---

## Wann MEMORY.md aktualisieren

- Nach Architektur-Entscheidungen (neue Patterns, geaenderte Interfaces)
- Neue Framework-Regel entdeckt (die der Linter nicht abfaengt)
- Projekt-Phase abgeschlossen
- Tech Stack geaendert (neue Dependency, Build-Tool-Wechsel)
- Deploy-Konfiguration geaendert

## Wann NICHT aktualisieren

- Einmalige Debug-Sessions (temporaere Workarounds)
- Unbestaetigte Vermutungen (erst verifizieren, dann speichern)
- Information steht schon in CLAUDE.md oder _devprocess/ (keine Duplikate)

---

## Referenz-Dateien

Wenn ein Thema zu detailliert fuer MEMORY.md wird (>10 Zeilen):

1. Eigene Datei anlegen: `memory/thema.md`
2. In MEMORY.md verlinken: `Siehe [thema.md](thema.md)`
3. MEMORY.md bleibt unter 200 Zeilen (danach wird truncated)

Typische Referenz-Dateien:
- `quality-rules.md` -- Framework-spezifische Regeln
- `patterns.md` -- Architektur-Patterns und Wiring
- `debugging.md` -- Geloeste Debugging-Faelle

---

## Projekt-zu-Projekt Evolution

```
Projekt 1 (erstes Projekt):
  ~/.claude/CLAUDE.md    <- kopiert aus _global/CLAUDE.md
  memory/MEMORY.md       <- kopiert aus _memory/MEMORY.md, befuellt

Projekt 2 (naechstes Projekt):
  ~/.claude/CLAUDE.md    <- NICHT ueberschrieben! Patterns aus Projekt 1 bleiben
  memory/MEMORY.md       <- frische Kopie, wird fuer Projekt 2 befuellt

Projekt 3, 4, 5...:
  ~/.claude/CLAUDE.md    <- waechst weiter, enthaelt Best Practices aller Projekte
  memory/MEMORY.md       <- immer frisch pro Projekt
```

Das Ergebnis: Die globale CLAUDE.md wird mit jedem Projekt besser.
Wie ein Entwickler der mit jedem Projekt dazulernt, aber bei jedem
neuen Projekt ein frisches Notizbuch aufschlaegt.
