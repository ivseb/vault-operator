/**
 * IMP-41-02-01c contract v2: the TaskRouter classification block and the
 * >= 2 consecutive-mistakes escalation move out of AgentTask.run() into an
 * interceptor. These tests pin the classification matrix (disabled toggle,
 * missing helper, simple/complex, router throw stays fail-open) and the
 * exact escalation boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RouterEscalationInterceptor, type RouterEscalationPorts } from '../interceptors/RouterEscalationInterceptor';
import type { LoopInterceptorContext, RunStartContext } from '../interceptors/types';
import { createInitialLoopState } from '../LoopState';

let debugSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
    debugSpy.mockRestore();
    warnSpy.mockRestore();
});

function makePorts(overrides: Partial<RouterEscalationPorts> = {}): RouterEscalationPorts {
    return {
        shouldRun: () => true,
        manualOverrideActive: () => false,
        isEnabled: () => true,
        helperModelName: () => 'haiku',
        classify: vi.fn(async () => 'simple' as const),
        switchToHelper: vi.fn(async () => undefined),
        mainModelId: () => 'main-model',
        escalateToMain: vi.fn(),
        ...overrides,
    };
}

function runStartCtx(text = 'create an xlsx'): RunStartContext {
    return { history: [], userMessageText: text };
}

function loopCtx(mistakes: number): LoopInterceptorContext {
    const state = createInitialLoopState();
    state.consecutiveMistakes = mistakes;
    return { state, history: [], activeMode: { name: 'Agent', slug: 'agent', roleDefinition: '' } };
}

describe('RouterEscalationInterceptor.onRunStart', () => {
    it('routes to the helper on a simple classification', async () => {
        const ports = makePorts();
        const interceptor = new RouterEscalationInterceptor(ports);

        await interceptor.onRunStart(runStartCtx());

        expect(ports.classify).toHaveBeenCalledWith('create an xlsx');
        expect(ports.switchToHelper).toHaveBeenCalledTimes(1);
        expect(interceptor.getDecision()).toBe('simple');
    });

    it('stays on main for complex/unknown classifications', async () => {
        const ports = makePorts({ classify: vi.fn(async () => 'complex' as const) });
        const interceptor = new RouterEscalationInterceptor(ports);

        await interceptor.onRunStart(runStartCtx());

        expect(ports.switchToHelper).not.toHaveBeenCalled();
        expect(interceptor.getDecision()).toBe('complex');
    });

    it('does nothing when the router gate is closed, logging only for a manual override', async () => {
        const p1 = makePorts({ shouldRun: () => false, manualOverrideActive: () => false });
        await new RouterEscalationInterceptor(p1).onRunStart(runStartCtx());
        expect(p1.classify).not.toHaveBeenCalled();
        expect(debugSpy).not.toHaveBeenCalled();

        const p2 = makePorts({ shouldRun: () => false, manualOverrideActive: () => true });
        await new RouterEscalationInterceptor(p2).onRunStart(runStartCtx());
        expect(p2.classify).not.toHaveBeenCalled();
        expect(debugSpy).toHaveBeenCalledWith(
            '[TaskRouter] skipped -- manual model override active. Staying on the picked model.',
        );
    });

    it('skips classification when the toggle is off or no helper model is configured', async () => {
        const p1 = makePorts({ isEnabled: () => false });
        await new RouterEscalationInterceptor(p1).onRunStart(runStartCtx());
        expect(p1.classify).not.toHaveBeenCalled();

        const p2 = makePorts({ helperModelName: () => null });
        await new RouterEscalationInterceptor(p2).onRunStart(runStartCtx());
        expect(p2.classify).not.toHaveBeenCalled();
    });

    it('stays fail-open (main api, warn) when the router throws', async () => {
        const ports = makePorts({ classify: vi.fn(async () => { throw new Error('router broke'); }) });
        const interceptor = new RouterEscalationInterceptor(ports);

        await interceptor.onRunStart(runStartCtx());

        expect(ports.switchToHelper).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith('[TaskRouter] router failed, staying on main api:', expect.any(Error));
        expect(interceptor.getDecision()).toBe('disabled');
    });
});

describe('RouterEscalationInterceptor.onToolResult', () => {
    it('escalates exactly at the >= 2 consecutive-mistakes boundary', () => {
        const ports = makePorts();
        const interceptor = new RouterEscalationInterceptor(ports);

        interceptor.onToolResult({ toolName: 'write_file', isError: true }, loopCtx(1));
        expect(ports.escalateToMain).not.toHaveBeenCalled();

        interceptor.onToolResult({ toolName: 'write_file', isError: true }, loopCtx(2));
        expect(ports.escalateToMain).toHaveBeenCalledTimes(1);
    });

    it('never escalates after a success reset', () => {
        const ports = makePorts();
        const interceptor = new RouterEscalationInterceptor(ports);

        interceptor.onToolResult({ toolName: 'read_file', isError: false }, loopCtx(0));

        expect(ports.escalateToMain).not.toHaveBeenCalled();
    });
});
