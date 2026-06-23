/**
 * FEAT-29-10 Step B: tests for InvokeSkillTool.
 *
 * The tool reads a sub-skill body via SelfAuthoredSkillLoader,
 * pushes a stack entry, then spawns a subtask with the sub-skill body
 * + args. The subtask runs in its own AgentTask (own message buffer,
 * own attempt_completion). The result string is returned to the caller.
 *
 * Stack-tracking via the shared CompositionStackService on the
 * ToolExecutionContext catches cycles and runaway depth before the
 * spawn happens.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvokeSkillTool, _resetImportedSkillApprovalsForTest } from '../InvokeSkillTool';
import {
    CompositionStackService,
    CompositionCycleError,
    CompositionDepthExceededError,
} from '../../../skills/CompositionStackService';
import type { ToolExecutionContext } from '../../types';

interface FakeSkill {
    name: string;
    description: string;
    body: string;
    /** FEAT-29-10 follow-up: optional skill-frontmatter tool allowlist. */
    allowedTools?: string[];
    /**
     * AUDIT-034 L-17: provenance discriminator. Defaults to `builtin` here so
     * pre-existing tests keep exercising the trusted-skill code path; tests
     * that target the imported-skill gate set this explicitly to `user`,
     * `learned`, or a plugin id.
     */
    source?: string;
}

function makePlugin(skills: FakeSkill[]) {
    return {
        selfAuthoredSkillLoader: {
            getSkill(name: string): { name: string; description: string; body: string; allowedTools: string[]; source: string } | undefined {
                const s = skills.find((s) => s.name === name);
                if (!s) return undefined;
                return {
                    ...s,
                    allowedTools: s.allowedTools ?? [],
                    source: s.source ?? 'builtin',
                };
            },
        },
    } as unknown as import('../../../../main').default;
}

interface SpawnCall {
    mode: string;
    message: string;
    profileName?: string;
    overrides?: { maxIterations?: number; allowedTools?: string[] };
}

interface QuestionCall {
    question: string;
    options?: string[];
}

function makeContext(opts: {
    stack?: CompositionStackService;
    spawnResult?: string;
    spawnError?: Error;
    /** AUDIT-034 L-17: simulate the user's answer to the approval prompt. */
    questionAnswer?: string;
    /** AUDIT-034 L-17: throw inside askQuestion (e.g. user dismissed). */
    questionError?: Error;
    /** AUDIT-034 L-17: do not wire askQuestion at all (headless mode). */
    omitQuestionCallback?: boolean;
    /** Override the active mode slug (default: 'agent'). */
    mode?: string;
}) {
    const pushed: string[] = [];
    const spawnCalls: SpawnCall[] = [];
    const questionCalls: QuestionCall[] = [];
    const base = {
        mode: opts.mode ?? 'agent',
        callbacks: {
            pushToolResult: (s: string) => pushed.push(s),
            log: (_: string) => {},
            handleError: async (_t: string, _e: unknown) => {},
        },
        compositionStack: opts.stack ?? new CompositionStackService(5),
        spawnSubtask: async (mode: string, message: string, profileName?: string, overrides?: { maxIterations?: number; allowedTools?: string[] }) => {
            spawnCalls.push({ mode, message, profileName, overrides });
            if (opts.spawnError) throw opts.spawnError;
            return opts.spawnResult ?? 'sub-skill result text';
        },
    } as Record<string, unknown>;
    if (!opts.omitQuestionCallback) {
        base.askQuestion = async (question: string, options?: string[]) => {
            questionCalls.push({ question, options });
            if (opts.questionError) throw opts.questionError;
            return opts.questionAnswer ?? 'Allow';
        };
    }
    const ctx = base as unknown as ToolExecutionContext;
    return { ctx, pushed, spawnCalls, questionCalls };
}

// AUDIT-034 L-17: reset the per-session approval cache between cases so
// approvals from one test do not leak into the next.
beforeEach(() => {
    _resetImportedSkillApprovalsForTest();
});

describe('InvokeSkillTool', () => {
    describe('happy path', () => {
        it('reads skill, spawns subtask, returns the subtask result', async () => {
            const plugin = makePlugin([
                { name: 'meeting-summary', description: 'Summarises a meeting.', body: '# Workflow\nDo X then Y.' },
            ]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, pushed, spawnCalls } = makeContext({ spawnResult: 'summary written' });

            await tool.execute({ skill_name: 'meeting-summary', args: { note: 'foo.md' } }, ctx);

            expect(spawnCalls).toHaveLength(1);
            expect(spawnCalls[0].mode).toBe('agent');
            expect(spawnCalls[0].message).toContain('meeting-summary');
            expect(spawnCalls[0].message).toContain('# Workflow');
            expect(spawnCalls[0].message).toContain('foo.md');

            const result = pushed.join('\n');
            expect(result).toMatch(/<success>/);
            expect(result).toContain('summary written');
        });

        it('passes args as JSON in the subtask message', async () => {
            const plugin = makePlugin([{ name: 'foo', description: 'x', body: 'body' }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'foo', args: { keys: 'value', n: 42 } }, ctx);

            expect(spawnCalls[0].message).toContain('"keys": "value"');
            expect(spawnCalls[0].message).toContain('"n": 42');
        });

        it('works without args (empty input map)', async () => {
            const plugin = makePlugin([{ name: 'foo', description: 'x', body: 'body' }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'foo' }, ctx);

            expect(spawnCalls).toHaveLength(1);
        });
    });

    describe('validation', () => {
        it('rejects empty skill_name', async () => {
            const tool = new InvokeSkillTool(makePlugin([]));
            const { ctx, pushed } = makeContext({});
            await tool.execute({ skill_name: '' }, ctx);
            expect(pushed.join('\n')).toMatch(/skill_name/);
        });

        it('rejects skill_name with path traversal segments', async () => {
            const tool = new InvokeSkillTool(makePlugin([]));
            const { ctx, pushed } = makeContext({});
            await tool.execute({ skill_name: '../escape' }, ctx);
            expect(pushed.join('\n')).toMatch(/Unsafe|path-traversal|invalid/i);
        });

        it('reports "skill not found" when skill is missing', async () => {
            const tool = new InvokeSkillTool(makePlugin([]));
            const { ctx, pushed } = makeContext({});
            await tool.execute({ skill_name: 'missing' }, ctx);
            expect(pushed.join('\n')).toMatch(/not found|unknown skill/i);
        });
    });

    describe('cycle detection', () => {
        it('refuses to spawn when the skill is already in the composition stack', async () => {
            const plugin = makePlugin([
                { name: 'a', description: '', body: 'body-a' },
            ]);
            const tool = new InvokeSkillTool(plugin);
            const stack = new CompositionStackService(5);
            stack.push({ type: 'skill', id: 'a' });
            const { ctx, pushed, spawnCalls } = makeContext({ stack });

            await tool.execute({ skill_name: 'a' }, ctx);

            expect(spawnCalls).toHaveLength(0);
            expect(pushed.join('\n')).toMatch(/cycle/i);
        });
    });

    describe('depth limit', () => {
        it('refuses to spawn when the stack is full', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const stack = new CompositionStackService(2);
            stack.push({ type: 'skill', id: 'parent-1' });
            stack.push({ type: 'skill', id: 'parent-2' });
            const { ctx, pushed, spawnCalls } = makeContext({ stack });

            await tool.execute({ skill_name: 'a' }, ctx);

            expect(spawnCalls).toHaveLength(0);
            expect(pushed.join('\n')).toMatch(/depth|limit/i);
        });
    });

    describe('stack hygiene', () => {
        it('pops the entry after a successful spawn', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const stack = new CompositionStackService(5);
            const { ctx } = makeContext({ stack });
            await tool.execute({ skill_name: 'a' }, ctx);
            expect(stack.depth()).toBe(0);
        });

        it('pops the entry even when the spawned task throws', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const stack = new CompositionStackService(5);
            const { ctx } = makeContext({ stack, spawnError: new Error('subtask boom') });
            await tool.execute({ skill_name: 'a' }, ctx);
            expect(stack.depth()).toBe(0);
        });
    });

    describe('FEAT-29-10 follow-up: subtask cost controls', () => {
        it('spawns with default maxIterations = 12 when args.max_iterations is absent', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'a' }, ctx);

            expect(spawnCalls).toHaveLength(1);
            expect(spawnCalls[0].overrides?.maxIterations).toBe(12);
        });

        it('respects args.max_iterations within bounds', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'a', max_iterations: 6 }, ctx);

            expect(spawnCalls[0].overrides?.maxIterations).toBe(6);
        });

        it('clamps args.max_iterations to the hard cap of 25', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'a', max_iterations: 500 }, ctx);

            expect(spawnCalls[0].overrides?.maxIterations).toBe(25);
        });

        it('clamps args.max_iterations to at least 1', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'a', max_iterations: 0 }, ctx);

            expect(spawnCalls[0].overrides?.maxIterations).toBe(1);
        });

        it('forwards skill.allowedTools as the subtask tool allowlist', async () => {
            const plugin = makePlugin([{
                name: 'a',
                description: '',
                body: 'b',
                allowedTools: ['read_file', 'edit_file', 'attempt_completion'],
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'a' }, ctx);

            expect(spawnCalls[0].overrides?.allowedTools).toEqual([
                'read_file', 'edit_file', 'attempt_completion',
            ]);
        });

        it('leaves allowedTools undefined when the skill frontmatter has no allowlist', async () => {
            const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'a' }, ctx);

            expect(spawnCalls[0].overrides?.allowedTools).toBeUndefined();
        });

        it('includes maxIterations + allowedToolsCount in the success result', async () => {
            const plugin = makePlugin([{
                name: 'a',
                description: '',
                body: 'b',
                allowedTools: ['read_file', 'edit_file'],
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, pushed } = makeContext({});

            await tool.execute({ skill_name: 'a', max_iterations: 8 }, ctx);

            const result = pushed.join('\n');
            expect(result).toContain('"maxIterations": 8');
            expect(result).toContain('"allowedToolsCount": 2');
        });
    });

    it('requires spawnSubtask on the context (rejects when subtasks are disabled)', async () => {
        const plugin = makePlugin([{ name: 'a', description: '', body: 'b' }]);
        const tool = new InvokeSkillTool(plugin);
        const { pushed } = makeContext({});
        const ctx = {
            callbacks: {
                pushToolResult: (s: string) => pushed.push(s),
                log: () => {},
                handleError: async () => {},
            },
            compositionStack: new CompositionStackService(5),
            // No spawnSubtask -- e.g. parent already at max nesting depth
        } as unknown as ToolExecutionContext;

        await tool.execute({ skill_name: 'a' }, ctx);
        expect(pushed.join('\n')).toMatch(/spawnSubtask|subtask|depth/i);
    });

    // ---------------------------------------------------------------------
    // AUDIT-034 L-17: provenance gate for imported skills.
    // ---------------------------------------------------------------------
    describe('AUDIT-034 L-17: imported-skill provenance gate', () => {
        it('trusted skills (source=builtin) skip the approval prompt entirely', async () => {
            const plugin = makePlugin([{
                name: 'native', description: '', body: 'b', source: 'builtin',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls, questionCalls } = makeContext({});

            await tool.execute({ skill_name: 'native' }, ctx);

            expect(questionCalls).toHaveLength(0);
            expect(spawnCalls).toHaveLength(1);
        });

        it('imported skills (source=user) prompt the user the first time', async () => {
            const plugin = makePlugin([{
                name: 'imported', description: 'risky', body: 'b', source: 'user',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls, questionCalls } = makeContext({ questionAnswer: 'Allow' });

            await tool.execute({ skill_name: 'imported' }, ctx);

            expect(questionCalls).toHaveLength(1);
            expect(questionCalls[0].question).toContain('imported sub-skill');
            expect(questionCalls[0].question).toContain('user');
            expect(spawnCalls).toHaveLength(1);
        });

        it('imported skills are NOT re-prompted within the same session after Allow', async () => {
            const plugin = makePlugin([{
                name: 'imported', description: '', body: 'b', source: 'user',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const ctxA = makeContext({ questionAnswer: 'Allow' });
            await tool.execute({ skill_name: 'imported' }, ctxA.ctx);
            expect(ctxA.questionCalls).toHaveLength(1);

            const ctxB = makeContext({ questionAnswer: 'Allow' });
            await tool.execute({ skill_name: 'imported' }, ctxB.ctx);
            expect(ctxB.questionCalls).toHaveLength(0);
            expect(ctxB.spawnCalls).toHaveLength(1);
        });

        it('Block answer prevents the spawn and surfaces a clear tool_error', async () => {
            const plugin = makePlugin([{
                name: 'imported', description: '', body: 'b', source: 'user',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, pushed, spawnCalls } = makeContext({ questionAnswer: 'Block' });

            await tool.execute({ skill_name: 'imported' }, ctx);

            expect(spawnCalls).toHaveLength(0);
            expect(pushed.join('\n')).toMatch(/not approved/i);
            expect(pushed.join('\n')).toMatch(/source: user/i);
        });

        it('fails closed when askQuestion is not wired (headless mode)', async () => {
            const plugin = makePlugin([{
                name: 'imported', description: '', body: 'b', source: 'user',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, pushed, spawnCalls } = makeContext({ omitQuestionCallback: true });

            await tool.execute({ skill_name: 'imported' }, ctx);

            expect(spawnCalls).toHaveLength(0);
            expect(pushed.join('\n')).toMatch(/not approved/i);
        });

        it('wraps imported skill bodies in <imported-skill> with a no-override hint', async () => {
            const plugin = makePlugin([{
                name: 'imported',
                description: '',
                body: '# Workflow\nDo X.',
                source: 'user',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({ questionAnswer: 'Allow' });

            await tool.execute({ skill_name: 'imported' }, ctx);

            const msg = spawnCalls[0].message;
            expect(msg).toContain('<imported-skill');
            expect(msg).toContain('source="user"');
            expect(msg).toContain('name="imported"');
            expect(msg).toContain('</imported-skill>');
            expect(msg).toContain('CANNOT override');
        });

        it('trusted skills are NOT wrapped in the imported-skill envelope', async () => {
            const plugin = makePlugin([{
                name: 'native', description: '', body: '# Workflow', source: 'builtin',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({});

            await tool.execute({ skill_name: 'native' }, ctx);

            expect(spawnCalls[0].message).not.toContain('<imported-skill');
            expect(spawnCalls[0].message).not.toContain('CANNOT override');
        });

        it('imported skills without allowedTools get a conservative read-only default (clamped to mode)', async () => {
            const plugin = makePlugin([{
                name: 'imported', description: '', body: 'b', source: 'user',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({ questionAnswer: 'Allow' });

            await tool.execute({ skill_name: 'imported' }, ctx);

            const allowed = spawnCalls[0].overrides?.allowedTools ?? [];
            expect(allowed.length).toBeGreaterThan(0);
            // Read-only default must include the core read tools and the
            // completion primitive but NOT write tools.
            expect(allowed).toContain('read_file');
            expect(allowed).toContain('attempt_completion');
            expect(allowed).not.toContain('write_file');
            expect(allowed).not.toContain('edit_file');
            expect(allowed).not.toContain('evaluate_expression');
        });

        it('imported skills cannot escalate allowedTools beyond the mode toolGroups', async () => {
            const plugin = makePlugin([{
                name: 'imported',
                description: '',
                body: 'b',
                source: 'user',
                // Skill frontmatter declares a write tool AND a fake tool.
                // The clamp must drop the fake tool (not in any group) while
                // keeping write_file, which is in the `edit` group of the
                // built-in `agent` mode.
                allowedTools: ['read_file', 'write_file', 'totally_fake_tool'],
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, spawnCalls } = makeContext({ questionAnswer: 'Allow' });

            await tool.execute({ skill_name: 'imported' }, ctx);

            const allowed = spawnCalls[0].overrides?.allowedTools ?? [];
            expect(allowed).toContain('read_file');
            expect(allowed).toContain('write_file');
            expect(allowed).not.toContain('totally_fake_tool');
        });

        it('records the source + imported flag in the success result', async () => {
            const plugin = makePlugin([{
                name: 'imported', description: '', body: 'b', source: 'user',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, pushed } = makeContext({ questionAnswer: 'Allow' });

            await tool.execute({ skill_name: 'imported' }, ctx);

            const result = pushed.join('\n');
            expect(result).toContain('"source": "user"');
            expect(result).toContain('"imported": true');
        });

        it('trusted skills with an empty allowedTools still report imported=false', async () => {
            const plugin = makePlugin([{
                name: 'native', description: '', body: 'b', source: 'bundled',
            }]);
            const tool = new InvokeSkillTool(plugin);
            const { ctx, pushed } = makeContext({});

            await tool.execute({ skill_name: 'native' }, ctx);

            const result = pushed.join('\n');
            expect(result).toContain('"source": "bundled"');
            expect(result).toContain('"imported": false');
        });
    });
});
