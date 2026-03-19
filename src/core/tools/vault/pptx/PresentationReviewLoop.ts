export const QA_SYSTEM_PROMPT = `Du bist ein Praesentations-Qualitaetspruefer. Analysiere jede Folie auf diese Kriterien:

1. TEXT_OVERFLOW: Ist Text abgeschnitten oder laeuft ueber die Shape-Grenzen? Achte auf abgeschnittene Woerter am Rand.
2. EMPTY_SHAPE: Sind leere Platzhalter sichtbar, die haetten befuellt werden sollen? (Leere Textboxen, "Click to add" Text)
3. LAYOUT_BALANCE: Ist die Folie visuell ausgewogen oder gibt es zu viel Leerraum auf einer Seite?
4. READABILITY: Ist die Schrift gross genug? Kontrast ausreichend? Text lesbar?
5. CONSISTENCY: Folgen die Folien einer visuellen Linie? (Schriftgroessen, Abstände, Farbverwendung)

Pro Folie:
- status: "pass" (keine Issues), "warn" (kleinere Probleme), "fail" (kritische Probleme)
- issues: Array von {type, severity, description, fix}
  - type: text_overflow | empty_shape | layout_balance | readability | consistency
  - severity: info | warning | error
  - description: Was genau ist das Problem? (deutsch, 1 Satz)
  - fix: Konkreter Vorschlag zur Behebung (deutsch, 1 Satz)

Abschluss:
- overall: "pass" (alle Folien ok), "needs_revision" (Fixes empfohlen), "critical" (Ueberarbeitung noetig)
- summary: 1-2 Saetze Gesamtbewertung

Output als JSON (kein Markdown):
{
  "overall": "pass|needs_revision|critical",
  "summary": "...",
  "slides": [
    {
      "slideNumber": 1,
      "status": "pass|warn|fail",
      "issues": [
        {"type": "...", "severity": "...", "description": "...", "fix": "..."}
      ]
    }
  ]
}`;

export interface QaReport {
    overall: 'pass' | 'needs_revision' | 'critical';
    summary: string;
    slides: QaSlide[];
}

export interface QaSlide {
    slideNumber: number;
    status: 'pass' | 'warn' | 'fail';
    issues: QaIssue[];
}

export interface QaIssue {
    type: string;
    severity: string;
    description: string;
    fix: string;
}

export function parseQaReport(responseText: string): QaReport {
    let json = responseText.trim();
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    try {
        const parsed = JSON.parse(json) as QaReport;
        return {
            overall: parsed.overall ?? 'needs_revision',
            summary: parsed.summary ?? 'Quality check completed.',
            slides: (parsed.slides ?? []).map(slide => ({
                slideNumber: slide.slideNumber ?? 0,
                status: slide.status ?? 'warn',
                issues: (slide.issues ?? []).map(issue => ({
                    type: issue.type ?? 'unknown',
                    severity: issue.severity ?? 'warning',
                    description: issue.description ?? '',
                    fix: issue.fix ?? '',
                })),
            })),
        };
    } catch (error) {
        console.warn('[PresentationReviewLoop] Failed to parse QA report:', error);
        return {
            overall: 'needs_revision',
            summary: `Quality check returned non-JSON response. Raw output:\n${responseText.substring(0, 500)}`,
            slides: [],
        };
    }
}
