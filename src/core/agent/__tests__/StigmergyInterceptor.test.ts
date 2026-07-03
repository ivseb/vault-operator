/**
 * IMP-41-02-01c contract v2: the Stigmergy consult/grade lifecycle as an
 * interceptor. Pins the VO/Stigmergy contract (candidate_ids join all
 * four namespaced surfaces and equal the registration superset), skill
 * dedupe, the non-fatal enumeration paths, the desc map, and the
 * onRunEnd matrix (end() always precedes exactly one of accept/abandon,
 * accept amount = input + output totals).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StigmergyInterceptor, type StigmergyPorts } from '../interceptors/StigmergyInterceptor';
import { createInitialLoopState } from '../LoopState';
import type { LoopInterceptorContext, RunStartContext } from '../interceptors/types';
import type { StigmergyTurn } from '../../stigmergy/StigmergyAdapter';
import type { ToolDefinition } from '../../tools/types';

const { beginTurnMock, registerMock } = vi.hoisted(() => ({
    beginTurnMock: vi.fn(),
    registerMock: vi.fn(async () => undefined),
}));

vi.mock('../../stigmergy/StigmergyAdapter', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../stigmergy/StigmergyAdapter')>();
    return {
        ...actual,
        beginStigmergyTurn: beginTurnMock,
        registerCapabilitiesIfChanged: registerMock,
    };
});

interface FakeTurn {
    calls: string[];
    acceptAmounts: number[];
    turn: StigmergyTurn;
}

function makeFakeTurn(): FakeTurn {
    const calls: string[] = [];
    const acceptAmounts: number[] = [];
    const turn = {
        enabled: true,
        taskId: 't-1',
        decisionMode: 'none',
        orderTools: <T,>(tools: readonly T[]) => [...tools],
        pathGuidance: vi.fn(() => ({ text: '', path: [] as string[] })),
        end: vi.fn(async () => { calls.push('end'); }),
        accept: vi.fn(async (amount: number) => { calls.push('accept'); acceptAmounts.push(amount); }),
        abandon: vi.fn(async () => { calls.push('abandon'); }),
        emitInvoked: vi.fn(async () => undefined),
        emitReturned: vi.fn(async () => undefined),
    } as unknown as StigmergyTurn;
    return { calls, acceptAmounts, turn };
}

function toolDef(name: string, description = `${name} desc`): ToolDefinition {
    return { name, description, input_schema: { type: 'object', properties: {} } } as ToolDefinition;
}

function makePorts(overrides: Partial<StigmergyPorts> = {}): StigmergyPorts {
    return {
        taskId: 't-1',
        getTurnPrompt: () => 'summarize notes',
        getRegisteredTools: () => [toolDef('read_file'), toolDef('write_file')],
        getSelfAuthoredSkills: () => [{ name: 'weekly-report', description: 'weekly' }],
        discoverUserSkills: () => Promise.resolve([{ name: 'user-skill', description: 'user' }]),
        getMcpTools: () => [{ server: 'gh', name: 'list_issues', description: 'issues' }],
        getSubagentProfiles: () => [{ name: 'research', description: 'researcher' }],
        ...overrides,
    };
}

const runCtx: RunStartContext = { history: [], userMessageText: 'summarize notes' };

function endCtx(outcome: 'accept' | 'abandon', input = 100, output = 50): LoopInterceptorContext {
    const state = createInitialLoopState();
    state.stigmergyOutcome = outcome;
    state.totalInputTokens = input;
    state.totalOutputTokens = output;
    return { state, history: [], activeMode: { name: 'Agent', slug: 'agent', roleDefinition: '' } };
}

beforeEach(() => {
    beginTurnMock.mockReset();
    registerMock.mockClear();
    beginTurnMock.mockImplementation(async () => makeFakeTurn().turn);
});

describe('StigmergyInterceptor.onRunStart', () => {
    it('joins all four surfaces with namespaced ids equal to the registration superset', async () => {
        const interceptor = new StigmergyInterceptor(makePorts());

        await interceptor.onRunStart(runCtx);

        expect(registerMock).toHaveBeenCalledTimes(1);
        const regArgs = (registerMock.mock.calls[0] as unknown[])[0] as {
            tools: Array<{ name: string }>;
            skills: Array<{ name: string; description: string }>;
            mcp: Array<{ server: string; name: string; description: string }>;
            subagents: Array<{ name: string; description: string }>;
        };
        expect(regArgs.tools.map((t) => t.name)).toEqual(['read_file', 'write_file']);
        expect(regArgs.skills).toEqual([
            { name: 'weekly-report', description: 'weekly' },
            { name: 'user-skill', description: 'user' },
        ]);
        expect(regArgs.mcp).toEqual([{ server: 'gh', name: 'list_issues', description: 'issues' }]);
        expect(regArgs.subagents).toEqual([{ name: 'research', description: 'researcher' }]);
        const beginArgs = beginTurnMock.mock.calls[0][0] as { candidateIds: string[]; prompt: string; taskId: string };
        expect(beginArgs.taskId).toBe('t-1');
        expect(beginArgs.prompt).toBe('summarize notes');
        // VO/Stigmergy contract: candidate set == registered superset, namespaced.
        expect(beginArgs.candidateIds).toEqual([
            'read_file', 'write_file',
            'skill:weekly-report', 'skill:user-skill',
            'mcp:gh:list_issues',
            'subagent:research',
        ]);
    });

    it('dedupes skills across self-authored and user discovery', async () => {
        const ports = makePorts({
            getSelfAuthoredSkills: () => [{ name: 'weekly-report', description: 'self' }],
            discoverUserSkills: () => Promise.resolve([
                { name: 'weekly-report', description: 'user copy' },
                { name: 'other', description: 'o' },
            ]),
        });

        await new StigmergyInterceptor(ports).onRunStart(runCtx);

        const args = (registerMock.mock.calls[0] as unknown[])[0] as { skills: Array<{ name: string; description: string }> };
        expect(args.skills).toEqual([
            { name: 'weekly-report', description: 'self' }, // first writer wins
            { name: 'other', description: 'o' },
        ]);
    });

    it('treats skill and mcp enumeration failures as non-fatal', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        const ports = makePorts({
            getSelfAuthoredSkills: () => { throw new Error('loader broke'); },
            discoverUserSkills: () => Promise.reject(new Error('folder hangs')),
            getMcpTools: () => { throw new Error('mcp down'); },
        });
        const interceptor = new StigmergyInterceptor(ports);

        await interceptor.onRunStart(runCtx);

        const beginArgs = beginTurnMock.mock.calls[0][0] as { candidateIds: string[] };
        expect(beginArgs.candidateIds).toEqual(['read_file', 'write_file', 'subagent:research']);
        expect(interceptor.getTurn()).toBeDefined();
        debugSpy.mockRestore();
    });

    it('builds the four-surface description map and computes guidance', async () => {
        const fake = makeFakeTurn();
        beginTurnMock.mockResolvedValue(fake.turn);
        const interceptor = new StigmergyInterceptor(makePorts());

        await interceptor.onRunStart(runCtx);

        expect(interceptor.getDescriptionFor('read_file')).toBe('read_file desc');
        expect(interceptor.getDescriptionFor('skill:weekly-report')).toBe('weekly');
        expect(interceptor.getDescriptionFor('mcp:gh:list_issues')).toBe('issues');
        expect(interceptor.getDescriptionFor('subagent:research')).toBe('researcher');
        expect(fake.turn.pathGuidance).toHaveBeenCalledTimes(1);
        expect(interceptor.getGuidance()).toEqual({ text: '', path: [] });
    });

    it('throws on accessor use before onRunStart (programmer error)', () => {
        const interceptor = new StigmergyInterceptor(makePorts());
        expect(() => interceptor.getTurn()).toThrow('[Stigmergy] getTurn() before onRunStart()');
        expect(() => interceptor.getGuidance()).toThrow('[Stigmergy] getGuidance() before onRunStart()');
    });
});

describe('StigmergyInterceptor.onRunEnd', () => {
    it('always ends first, then accepts with input+output on an accept grading', async () => {
        const fake = makeFakeTurn();
        beginTurnMock.mockResolvedValue(fake.turn);
        const interceptor = new StigmergyInterceptor(makePorts());
        await interceptor.onRunStart(runCtx);

        await interceptor.onRunEnd(endCtx('accept', 120, 30));

        expect(fake.calls).toEqual(['end', 'accept']);
        expect(fake.acceptAmounts).toEqual([150]);
    });

    it('abandons on the default grading', async () => {
        const fake = makeFakeTurn();
        beginTurnMock.mockResolvedValue(fake.turn);
        const interceptor = new StigmergyInterceptor(makePorts());
        await interceptor.onRunStart(runCtx);

        await interceptor.onRunEnd(endCtx('abandon'));

        expect(fake.calls).toEqual(['end', 'abandon']);
    });

    it('is a no-op when the run never started', async () => {
        const interceptor = new StigmergyInterceptor(makePorts());
        await expect(interceptor.onRunEnd(endCtx('accept'))).resolves.toBeUndefined();
    });
});
