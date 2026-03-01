---
name: Requirements Engineer Quality Standards
applyTo: "_devprocess/requirements/epics/**/*.md, _devprocess/requirements/features/**/*.md, _devprocess/requirements/handoff/**/*.md"
description: "Qualitaetsregeln fuer Requirements Engineering - Epics, Features und Handoff-Dokumente"
---

# Requirements Engineer - Quality Standards

Diese Instructions werden automatisch angewendet beim Arbeiten mit Epic-, Feature- und Handoff-Dateien.

> **Ziel:** Der Architekt kann **sofort** mit ADRs starten UND Success Criteria sind tech-agnostisch.

---

## Unterstuetzte Dateitypen

```
_devprocess/requirements/epics/EPIC-*.md
_devprocess/requirements/features/FEATURE-*.md
_devprocess/requirements/handoff/architect-handoff.md
```

---

## Qualitaetsziele

### Fuer den Architekten
- Klar identifizierte ASRs (Critical/Moderate)
- Quantifizierte NFRs (mit Zahlen!)
- Dokumentierte Constraints
- Priorisierte Open Questions

### Fuer Claude Code (spaeter)
- Tech-agnostische Success Criteria (messbar ohne Tech-Wissen)
- Klare Scope Boundaries
- Quantifizierte NFRs als Akzeptanzkriterien

---

## KRITISCH: Tech-Agnostic Success Criteria Validation

### Verbotene Begriffe in Success Criteria

Diese Begriffe duerfen NICHT in der "Success Criteria (Tech-Agnostic)" Section erscheinen:

```
Authentication/Authorization:
  OAuth, JWT, SAML, OpenID, OIDC, Bearer, Token

API/Protocol:
  REST, GraphQL, gRPC, WebSocket, HTTP, HTTPS, API,
  JSON, XML, YAML, endpoint, request, response

Database:
  SQL, NoSQL, PostgreSQL, MySQL, MongoDB, Redis,
  Elasticsearch, DynamoDB, query, index, table

Frontend:
  React, Angular, Vue, Svelte, JavaScript, TypeScript,
  CSS, HTML, DOM, component, state management

Backend:
  Python, Java, Node, FastAPI, Express, Spring,
  Django, Flask, microservice, serverless, lambda

Infrastructure:
  Docker, Kubernetes, K8s, AWS, Azure, GCP,
  container, pod, cluster, load balancer, CDN

Performance (technical):
  ms, millisecond, latency, throughput, req/sec,
  cache, caching, Redis, Memcached

Security (technical):
  TLS, SSL, AES, encryption, hash, bcrypt,
  RBAC, ABAC, firewall, WAF

Messaging:
  Kafka, RabbitMQ, SQS, pub/sub, message queue,
  event-driven, async, webhook
```

### Fehlermeldung bei Tech-Begriff in Success Criteria

```
Success Criteria enthaelt Technologie-Begriff

Datei: FEATURE-042-user-authentication.md
Section: Success Criteria (Tech-Agnostic)
Problem: Technologie-Begriff gefunden

Gefunden:
  "Response time < 200ms via Redis caching"
       Enthaelt: "ms", "Redis", "caching"

  "OAuth 2.0 authentication required"
       Enthaelt: "OAuth", "2.0"

Korrektur-Vorschlaege:
  "Users experience sub-second response times"
  "Secure authentication using industry-standard protocols"

WARUM: Tech-agnostische Kriterien ermoeglichen objektive Messung
       unabhaengig von der gewaehlten Technologie.
       Technische Details gehoeren in die "Technical NFRs" Section.
```

### Transformation Guide: Tech -> Tech-Agnostic

| Technical (verboten) | Tech-Agnostic (erlaubt) |
|----------------------|-------------------------|
| Response time < 200ms | Users experience sub-second response |
| OAuth 2.0 authentication | Secure authentication using industry standards |
| PostgreSQL with indexes | System efficiently handles 100K+ records |
| REST API with JSON | Machine-readable interface for integrations |
| 99.9% uptime SLA | System available during business hours with minimal interruptions |
| Redis caching | Frequently accessed data loads instantly |
| RBAC authorization | Users only see data relevant to their role |
| TLS 1.3 encryption | Data transmitted securely |
| Kubernetes auto-scaling | System handles traffic spikes without degradation |
| WebSocket real-time | Users see updates without refreshing |

---

## Feature-Level Validierung

### Pflicht-Sections fuer Features

```
CHECK beim Speichern:

1. Feature Description vorhanden? (1-2 Absaetze)
2. Benefits Hypothesis vollstaendig?
3. User Stories vorhanden? (min. 1-3)
4. Success Criteria (Tech-Agnostic) Section vorhanden?
   - Alle Kriterien tech-frei?
   - Messbar?
   - User-outcome fokussiert?
5. Technical NFRs Section vorhanden?
   - Performance (mit Zahlen)
   - Security (spezifisch)
   - Scalability (messbar)
   - Availability (Uptime %)
6. ASRs identifiziert? (Critical/Moderate)
7. Definition of Done vollstaendig?
```

---

## Epic-Level Validierung (PoC & MVP)

### Pflicht-Sections fuer Epics

```
CHECK beim Speichern:

1. Epic Hypothesis Statement vollstaendig? (7/7 Komponenten)
2. Business Outcomes quantifiziert?
3. Leading Indicators definiert?
4. MVP Features Liste vorhanden? (min. 3)
5. Features priorisiert? (P0/P1/P2)
6. Out-of-Scope explizit?
7. Dependencies dokumentiert?
8. Risks identifiziert?
9. Technical Debt dokumentiert? (nur PoC)
```

---

## Anti-Patterns

### Tech-Begriffe in Success Criteria

```
FALSCH (Success Criteria Section):
"OAuth 2.0 authentication with JWT tokens"
"REST API response < 200ms"
"PostgreSQL queries with proper indexes"

RICHTIG (Success Criteria Section):
"Secure user authentication"
"Users experience instant response"
"System handles large datasets efficiently"
```

### Success Criteria ohne Messbarkeit

```
FALSCH:
"Good user experience"
"Fast performance"
"Secure system"

RICHTIG:
"95% task completion rate in UAT"
"Users perceive response as instant (<2 sec)"
"No unauthorized data access in security audit"
```

---

## Checkliste vor Handoff

### An Architect

```
- [ ] Alle Features haben Success Criteria (tech-agnostisch)
- [ ] Alle Features haben Technical NFRs (quantifiziert)
- [ ] Alle ASRs identifiziert (Critical/Moderate)
- [ ] architect-handoff.md erstellt
- [ ] Open Questions dokumentiert
```

---

**Version:** 2.1
**Focus:** Tech-agnostische Success Criteria + NFR-Trennung
**Quality Gate:** Architect-Ready Validation
