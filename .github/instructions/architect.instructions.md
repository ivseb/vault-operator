---
name: Architect Quality Standards
applyTo: "_devprocess/architecture/**/*.md, _devprocess/requirements/handoff/plan-context.md"
description: "Qualitaetsregeln fuer Architecture Decision Records und arc42 Dokumentation"
---

# Architect - Quality Standards

Diese Instructions werden automatisch angewendet beim Arbeiten mit ADRs und arc42 Dokumentation.

> **Ziel:** Vollstaendige Architektur-Vorschlaege die Claude Code als Kontext fuer den Implementierungsplan nutzen kann.

---

## Unterstuetzte Dateitypen

```
_devprocess/architecture/ADR-*.md
_devprocess/architecture/arc42.md
_devprocess/requirements/handoff/plan-context.md
```

---

## Qualitaetsziele

### Fuer Claude Code
- plan-context.md enthaelt alle technischen Constraints
- ADRs erklaeren WARUM Entscheidungen vorgeschlagen wurden (Kontext)
- arc42 Section 8 liefert das Data Model
- Tech Stack ist so praezise, dass Claude Code keine Annahmen treffen muss

---

## ADR Validierung

### Dateinamen-Konvention

```
Gueltig:
  ADR-001-backend-framework-selection.md
  ADR-002-database-choice.md
  ADR-015-authentication-strategy.md

Ungueltig:
  adr-001.md (lowercase prefix)
  ADR-1-framework.md (nicht 3-stellig)
  ADR-001-Backend Framework.md (Leerzeichen)
```

### Pflicht-Sections fuer ADRs

```
CHECK beim Speichern:

1. Header vollstaendig?
   - Status: [Proposed/Accepted/Deprecated/Superseded]
   - Date: YYYY-MM-DD
   - Deciders: Mindestens 1

2. Context Section?
   - Problem beschrieben
   - Triggering ASR referenziert (wenn vorhanden)
   - Quality Attribute genannt

3. Decision Drivers?
   - Mindestens 2 Drivers

4. Considered Options?
   - Mindestens 2 Optionen
   - Jede Option hat Pros und Cons

5. Decision?
   - Vorgeschlagene Option benannt
   - Begruendung vorhanden

6. Consequences?
   - Positive Konsequenzen
   - Negative Konsequenzen/Trade-offs
   - Risks (wenn vorhanden)

7. Implementation Notes? (optional aber empfohlen)
```

### ADR-ASR Traceability

```
CHECK: Hat jedes Critical ASR ein ADR?

Aus Features:
ASR: Response Time < 200ms -> ADR-003: Caching Strategy
ASR: 10,000 concurrent users -> ADR-005: Scaling Architecture
ASR: GDPR Compliance -> ADR-007: Data Architecture

Fehlermeldung wenn Critical ASR ohne ADR:
  Critical ASR ohne ADR gefunden!

  ASR: "Response Time < 200ms for 95th percentile"
  Source: FEATURE-001-user-dashboard.md
  Quality Attribute: Performance

  Aktion erforderlich:
    Erstelle ADR fuer dieses ASR:
    -> _devprocess/architecture/ADR-{XXX}-performance-optimization.md
```

---

## arc42 Validierung nach Scope

### Simple Test (Minimal)

```
PFLICHT-SECTIONS:
  Section 1: Introduction and Goals (1.1, 1.2)
  Section 3: Context and Scope (3.1 Business Context)
  Section 4: Solution Strategy (Technology Decisions)

OPTIONAL:
  Section 5: Building Block View
  Section 8: Crosscutting Concepts
```

### Proof of Concept (Moderate)

```
PFLICHT-SECTIONS:
  Section 1: Introduction and Goals (vollstaendig)
  Section 3: Context and Scope (3.1 + 3.2)
  Section 4: Solution Strategy (vollstaendig)
  Section 5: Building Block View (Level 1)
  Section 8: Crosscutting Concepts (8.1 Domain Model)

OPTIONAL:
  Section 6: Runtime View
  Section 7: Deployment View
  Section 9: Architecture Decisions (Tabelle)
  Section 11: Risks
```

### MVP (Vollstaendig)

```
PFLICHT-SECTIONS:
  Section 1: Introduction and Goals (vollstaendig)
  Section 2: Constraints (falls vorhanden)
  Section 3: Context and Scope (vollstaendig)
  Section 4: Solution Strategy (vollstaendig)
  Section 5: Building Block View (Level 1 + 2)
  Section 6: Runtime View (kritische Szenarien)
  Section 7: Deployment View
  Section 8: Crosscutting Concepts (vollstaendig)
  Section 9: Architecture Decisions (ADR Tabelle)
  Section 10: Quality Requirements
  Section 11: Risks and Technical Debt
  Section 12: Glossary
```

---

## plan-context.md Validierung

### Pflicht-Sections

```
CHECK _devprocess/requirements/handoff/plan-context.md:

1. Technical Stack Section?
   - Backend (Language, Framework, Database, ORM)
   - Frontend (wenn applicable)
   - Infrastructure (Cloud, Deployment, CI/CD)
   - API & Integration

2. Architecture Style?
   - Pattern genannt
   - Quality Goals (Top 3)

3. Key Architecture Decisions?
   - Mindestens 3 ADRs zusammengefasst
   - Jeder mit Rationale

4. Data Model?
   - Core Entities
   - Relationships

5. External Integrations?
   - System, Type, Protocol, Purpose

6. Performance & Security?
   - Mit konkreten Zahlen
   - Technische Details erlaubt
```

### ADR Summary Tabelle

```
CHECK: ADR Summary vorhanden?

| ADR | Title | Status | Impact |
|-----|-------|--------|--------|
| ADR-001 | Backend Framework | Proposed | High |
| ADR-002 | Database Choice | Proposed | High |
| ADR-003 | Auth Strategy | Proposed | High |

Mindestens 3 ADRs muessen gelistet sein!
```

### Consistency Check

```
CHECK: plan-context.md konsistent mit ADRs?

Vergleiche:
- Tech Stack in plan-context.md
- Decisions in ADR-*.md

Inkonsistenz gefunden:
  plan-context.md inkonsistent mit ADRs!

  plan-context.md sagt: "Database: MySQL"
  ADR-002 sagt: "Decision: PostgreSQL"

  Aktion: Korrigiere plan-context.md oder update ADR-002
```

---

## Anti-Patterns

### ADR ohne Alternativen

```
FALSCH:
## Considered Options
We chose React because it's popular.

RICHTIG:
## Considered Options

### Option 1: React
- Pro: Large ecosystem
- Pro: Team experience
- Con: Heavy bundle size

### Option 2: Vue
- Pro: Smaller bundle
- Pro: Easy learning curve
- Con: Less team experience

### Option 3: Svelte
- Pro: Smallest bundle
- Con: Newer, less mature ecosystem
- Con: No team experience
```

### plan-context.md ohne konkrete Werte

```
FALSCH:
### Performance & Security
- Fast response times
- Secure authentication
- Good scalability

RICHTIG:
### Performance & Security
- Response Time: < 200ms for 95th percentile
- Authentication: OAuth 2.0 via Azure AD B2C
- Scalability: 1,000 concurrent, auto-scale to 10,000
```

---

## Checkliste vor Handoff an Claude Code

```
- [ ] plan-context.md erstellt
- [ ] Tech Stack vollstaendig dokumentiert
- [ ] ADR Summary Table vorhanden (mind. 3 ADRs)
- [ ] Data Model definiert
- [ ] Performance/Security mit konkreten Zahlen
- [ ] arc42 scope-passend ausgefuellt
- [ ] Alle ADR-Pfade korrekt referenziert
```

---

**Version:** 2.1
**Focus:** ADR Quality + plan-context.md
**Quality Gate:** Claude Code Readiness
