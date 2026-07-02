import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TaskMonitor, type TaskMonitorOptions } from '../TaskMonitor';

/**
 * FIX-24-05-02: the sidebar onUsage callback dropped actualModelId and
 * routingMode, so TaskRouter-routed tasks were priced on the configured
 * main model (up to 15x off) and telemetry persisted the wrong modelId.
 *
 * TaskMonitor itself already supported the parameters (v2.10.2); these
 * tests lock the pricing behaviour, the telemetry modelId, and (via a
 * source pin) the AgentSidebarView pass-through.
 */

const recordSpy = vi.fn();

vi.mock('../../../core/telemetry/TaskTelemetry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../core/telemetry/TaskTelemetry')>();
    return {
        ...actual,
        TaskTelemetry: class {
            record = recordSpy;
            recordCondense = vi.fn();
        },
    };
});

vi.mock('../../../core/storage/VaultDataFileAdapter', () => ({
    VaultDataFileAdapter: class {},
}));

function makeMonitor(overrides: Partial<TaskMonitorOptions> = {}): { monitor: TaskMonitor; footerTexts: string[] } {
    const footerTexts: string[] = [];
    const footerEl = {
        setText: (s: string) => footerTexts.push(s),
        classList: { remove: vi.fn(), toggle: vi.fn() },
    } as unknown as HTMLElement;
    const opts: TaskMonitorOptions = {
        plugin: {
            settings: {
                activeModels: [],
                advancedApi: { costWarnThresholdEur: 0, telemetryRecordPromptPreview: false },
            },
        } as unknown as TaskMonitorOptions['plugin'],
        app: { vault: { adapter: {} } } as unknown as TaskMonitorOptions['app'],
        apiHandler: {
            getModel: () => ({ id: 'claude-opus-4-8', info: {} }),
        } as unknown as TaskMonitorOptions['apiHandler'],
        footerEl,
        getEffectiveModelKey: () => 'anthropic:claude-opus-4-8',
        promptPreview: 'test prompt',
        mode: 'agent',
        ...overrides,
    };
    return { monitor: new TaskMonitor(opts), footerTexts };
}

describe('TaskMonitor (FIX-24-05-02)', () => {
    beforeEach(() => {
        recordSpy.mockClear();
    });

    it('prices usage on the actualModelId when provided', () => {
        const { monitor, footerTexts } = makeMonitor();
        // 1M input on Haiku ($1/M) = $1.00 -> 0,93 EUR.
        monitor.onUsage(1_000_000, 0, 0, 0, 'claude-haiku-4-5', 'auto');
        expect(footerTexts.length).toBe(1);
        expect(footerTexts[0]).toContain('0,93');
    });

    it('falls back to the main-model id without actualModelId', () => {
        const { monitor, footerTexts } = makeMonitor();
        // 1M input on Opus 4.8 ($5/M) = $5.00 -> 4,65 EUR.
        monitor.onUsage(1_000_000, 0, 0, 0);
        expect(footerTexts[0]).toContain('4,65');
    });

    it('persists the last reported actualModelId in telemetry', async () => {
        const { monitor } = makeMonitor();
        monitor.onUsage(1000, 100, 0, 0, 'claude-haiku-4-5', 'auto');
        monitor.onTaskTelemetry({
            inputTokens: 1000,
            outputTokens: 100,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            toolSequence: [],
            iterations: 1,
            outcome: 'completed',
        });
        await vi.waitFor(() => expect(recordSpy).toHaveBeenCalledTimes(1));
        expect(recordSpy.mock.calls[0][0].modelId).toBe('claude-haiku-4-5');
    });

    it('persists the main-model id when no actualModelId was reported', async () => {
        const { monitor } = makeMonitor();
        monitor.onTaskTelemetry({
            inputTokens: 1000,
            outputTokens: 100,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            toolSequence: [],
            iterations: 1,
            outcome: 'completed',
        });
        await vi.waitFor(() => expect(recordSpy).toHaveBeenCalledTimes(1));
        expect(recordSpy.mock.calls[0][0].modelId).toBe('claude-opus-4-8');
    });

    // Source pin: AgentSidebarView must pass ALL onUsage parameters through
    // to TaskMonitor. The 2026-07 audit found the callback declared only 4
    // parameters, silently discarding modelId and routingMode.
    it('AgentSidebarView forwards modelId and routingMode to TaskMonitor.onUsage', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../AgentSidebarView.ts'),
            'utf-8',
        );
        expect(source).toMatch(
            /taskMonitor\.onUsage\(\s*inputTokens,\s*outputTokens,\s*cacheReadTokens,\s*cacheCreationTokens,\s*modelId,\s*routingMode,?\s*\)/,
        );
    });
});
