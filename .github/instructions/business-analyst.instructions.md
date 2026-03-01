---
name: Business Analyst Quality Standards
applyTo: "_devprocess/analysis/BA-*.md, _devprocess/analysis/constitution-draft.md"
description: "Qualitaetsregeln fuer Business Analysis Dokumente"
---

# Business Analyst - Quality Standards

Diese Instructions werden automatisch angewendet beim Arbeiten mit Business Analysis Dokumenten.

---

## Unterstuetzte Dateitypen

```
_devprocess/analysis/BA-*.md
_devprocess/analysis/constitution-draft.md
```

---

## Qualitaetsziele

### Fuer den Requirements Engineer
Der RE muss **sofort starten** koennen mit:
- Klarem Problem Statement
- Identifizierten User Personas
- Priorisierten Key Features
- Dokumentierten Constraints
- Definiertem Scope (In/Out)

---

## Validierungen nach Scope

### Simple Test (Scope A)

**Minimum erforderlich:**
```
Problem Statement (1-2 Saetze)
User Context (wer nutzt es?)
Hauptfunktionalitaet (was soll es tun?)
Erfolgskriterien (wann ist es fertig?)
```

**Validierungs-Check:**
```
CHECK fuer Simple Test:

1. Problem klar beschrieben?
2. User identifiziert?
3. Funktionalitaet definiert?
4. Definition of Done vorhanden?

Score: [X]/4 - Minimum 3/4 fuer RE-Ready
```

### Proof of Concept (Scope B)

**Erforderliche Sections:**
```
Executive Summary
Problem Statement
User Analysis (mind. 1 Persona)
Hypothesis (was validieren wir?)
Success Criteria
Scope (In/Out)
Constraints
Risks (technische Risiken)
Akzeptable Technical Debt
```

**Validierungs-Check:**
```
CHECK fuer PoC:

1. Hypothesis klar formuliert?
2. Technische Risiken identifiziert?
3. Erfolgskriterien messbar?
4. Out-of-Scope explizit?
5. Akzeptable Shortcuts dokumentiert?

Score: [X]/5 - Minimum 4/5 fuer RE-Ready
```

### Minimum Viable Product (Scope C)

**Vollstaendige Sections erforderlich:**
```
Executive Summary
Business Context (As-Is, To-Be, Gap)
Stakeholder Analysis (Map + Key Stakeholders)
User Analysis (2-3 Personas)
Problem Analysis (Statement, Root Causes, Impact)
Goals & Objectives (Business Goals, User Goals, KPIs)
Scope Definition (In, Out, Assumptions, Constraints)
Risk Assessment
Requirements Overview (Functional, Non-Functional, Key Features)
Next Steps
```

**Validierungs-Check:**
```
CHECK fuer MVP:

1. Business Context vollstaendig?
2. Stakeholder Map vorhanden?
3. Mind. 2 User Personas?
4. KPIs mit Baseline + Target?
5. In-Scope vs Out-of-Scope explizit?
6. Constraints dokumentiert?
7. Risiken identifiziert?
8. Key Features priorisiert (P0/P1/P2)?

Score: [X]/8 - Minimum 7/8 fuer RE-Ready
```

---

## Anti-Patterns

### Technische Loesungen vorschreiben

```
FALSCH (BA sollte nicht):
"Wir brauchen eine React-App mit PostgreSQL-Datenbank"
"Die API sollte REST sein mit JWT-Authentication"

RICHTIG (BA sollte):
"Wir brauchen eine moderne Web-Anwendung"
"Sichere Authentifizierung ist erforderlich"
```

### Vage Problem Statements

```
FALSCH:
"Die aktuelle Loesung ist nicht gut"
"User sind unzufrieden"

RICHTIG:
"Der aktuelle Prozess dauert 5 Stunden pro Woche und erzeugt 20% Fehlerrate"
"User brechen den Checkout-Prozess in 40% der Faelle ab"
```

### Fehlende Quantifizierung

```
FALSCH (KPIs):
"Schnellere Bearbeitung"
"Weniger Fehler"

RICHTIG (KPIs):
| KPI | Baseline | Target | Timeframe |
| Bearbeitungszeit | 5h/Woche | 1h/Woche | 3 Monate |
| Fehlerrate | 20% | <5% | 6 Monate |
```

---

## Checkliste vor Handoff

### An Requirements Engineer

```
- [ ] Alle Pflicht-Sections vorhanden (scope-spezifisch)
- [ ] Problem Statement klar und quantifiziert
- [ ] User identifiziert und beschrieben
- [ ] Scope explizit (In/Out)
- [ ] Constraints dokumentiert
- [ ] Key Features priorisiert
- [ ] Offene Fragen dokumentiert
- [ ] Naechste Schritte definiert
```

---

**Version:** 2.1
**Focus:** Business Analysis
**Quality Gate:** RE-Ready Validation
