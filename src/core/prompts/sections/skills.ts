/**
 * Skills Section
 *
 * Injects relevant skills for the current message. Skills are wrapped
 * in boundary tags to separate trusted system metadata from user-defined
 * skill content.
 */

export function getSkillsSection(skillsSection?: string): string {
    if (!skillsSection?.trim()) return '';

    return [
        '',
        '====',
        '',
        'ACTIVE SKILLS',
        '',
        'SKILL PRECEDENCE (MANDATORY):',
        '1. Active skills OVERRIDE default tool selection and general guidelines.',
        '2. Follow skill workflows STEP BY STEP. Do not skip steps.',
        '3. If a skill says "ASK the user", you MUST ask and STOP. Do not assume.',
        '4. If a skill says "use tool X", use that tool -- not an alternative.',
        '5. If no skill applies, proceed with normal tools and capabilities.',
        '',
        '<available_skills>',
        skillsSection.trim(),
        '</available_skills>',
    ].join('\n');
}
