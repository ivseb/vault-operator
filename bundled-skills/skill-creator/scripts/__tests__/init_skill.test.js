import { describe, expect, it } from 'vitest';

import {
    planSchemaStub,
    renderFinalCheck,
    renderSkillMd,
    skillDataRootOf,
    skillRootOf,
    validateName,
} from '../init_skill.js';

describe('validateName', () => {
    it('accepts a kebab name', () => expect(validateName('angebots-check')).toBe('angebots-check'));
    it('rejects a reserved substring', () => expect(() => validateName('claude-tool')).toThrow(/claude/));
    it('rejects a double hyphen', () => expect(() => validateName('a--b')).toThrow());
    it('rejects a non-string', () => expect(() => validateName(null)).toThrow(/required/));
});

describe('host paths', () => {
    it('builds the skill root from the injected skills_root', () => {
        expect(skillRootOf({ skills_root: '/vault/.vault-operator/data/skills' }, 'demo')).toBe(
            '/vault/.vault-operator/data/skills/demo',
        );
    });
    it('refuses when the host injected nothing', () => {
        expect(() => skillRootOf({}, 'demo')).toThrow(/skills_root was not provided/);
    });
    it('puts the brief under skill-data, derived if the dedicated key is absent', () => {
        expect(skillDataRootOf({ skills_root: '/v/.vault-operator/data/skills' }, 'demo')).toBe(
            '/v/.vault-operator/data/skill-data/skill-creator/demo',
        );
    });
    it('prefers the injected skill_data_root when present', () => {
        expect(skillDataRootOf({ skill_data_root: '/v/data/skill-data', skills_root: '/x' }, 'demo')).toBe(
            '/v/data/skill-data/skill-creator/demo',
        );
    });
});

describe('rendered files are valid', () => {
    it('SKILL.md has the frontmatter the loader needs', () => {
        const md = renderSkillMd('demo-skill', 'recipe', 'Use this to demo the thing.');
        expect(md).toMatch(/^---\nname: demo-skill\n/);
        expect(md).toContain('source: agent');
        expect(md).toContain('description: Use this to demo the thing.');
    });
    it('the final check exports execute and blocks unfilled', () => {
        const js = renderFinalCheck('demo-skill', 'demo_skill');
        expect(js).toMatch(/export\s+async\s+function\s+execute\s*\(/);
        expect(js).toContain('the domain checks are not written yet');
    });
    it('the plan schema stub is valid JSON and closed', () => {
        const schema = JSON.parse(planSchemaStub());
        expect(schema.additionalProperties).toBe(false);
    });
});
