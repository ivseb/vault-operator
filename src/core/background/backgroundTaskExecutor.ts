/**
 * Real executor for background research tasks (IMP-41-03-05).
 *
 * Builds a headless AgentTaskRunner constrained by the research subagent
 * profile (read-only tool surface, no further subagents) on the helper
 * model when one is configured. The collected report is saved as a NEW
 * conversation in the history and announced with a Notice — the
 * foreground chat stays untouched.
 */

import { Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { AgentTaskRunner } from '../agent/AgentTaskRunner';
import { getSubagentProfile } from '../agent/subagent-profiles';
import { getHelperApi } from '../helper-api';
import type { MessageParam } from '../../api/types';
import type { BackgroundTaskExecutor } from './BackgroundTaskRunner';

const BACKGROUND_MAX_ITERATIONS = 15;

export function createBackgroundTaskExecutor(plugin: ObsidianAgentPlugin): BackgroundTaskExecutor {
    return async ({ taskId, message, abortSignal }) => {
        if (!plugin.apiHandler) {
            new Notice('Background task failed: no model configured.');
            return '';
        }
        const profile = getSubagentProfile('research');
        const api = getHelperApi(plugin, plugin.apiHandler);

        const textParts: string[] = [];
        const history: MessageParam[] = [];
        const runner = new AgentTaskRunner({
            api,
            toolRegistry: plugin.toolRegistry,
            // No modeService: AgentTask falls back to BUILT_IN_MODES for the
            // 'agent' slug; the research profile overrides role + tools anyway.
            maxIterations: BACKGROUND_MAX_ITERATIONS,
            // depth 1: the background task cannot fork further subtasks or
            // background tasks — combined with the read-only profile below.
            depth: 1,
            callbacks: {
                onText: (text) => { textParts.push(text); },
                onThinking: () => { /* headless */ },
                onToolStart: () => { /* headless */ },
                onToolResult: () => { /* headless */ },
                onComplete: () => { /* resolved below */ },
                onError: (err) => {
                    textParts.push(`\n\n[Background task error] ${err.message}`);
                },
            },
        });

        await runner.execute({
            userMessage: message,
            taskId,
            initialMode: 'agent',
            history,
            abortSignal,
            subagentRoleOverride: profile?.roleDefinition,
            subagentAllowedTools: profile?.allowedTools,
            configDir: plugin.app.vault.configDir,
        });

        const report = textParts.join('').trim();
        const aborted = abortSignal.aborted;

        // Persist the report as its own conversation so it shows up in the
        // history panel; skip when aborted or empty.
        if (report && !aborted && plugin.conversationStore) {
            try {
                const id = await plugin.conversationStore.create('agent', api.getModel().id);
                await plugin.conversationStore.save(id, history, [
                    { role: 'user', text: `[Background research] ${message}`, ts: new Date().toISOString() },
                    { role: 'assistant', text: report, ts: new Date().toISOString() },
                ]);
                plugin.app.workspace.containerEl.dispatchEvent(
                    new CustomEvent('vault-operator:conversation-list-changed'),
                );
            } catch (e) {
                console.warn('[BackgroundTask] saving report failed (non-fatal):', e);
            }
        }

        new Notice(aborted
            ? 'Background research task stopped.'
            : report
                ? 'Background research task finished — the report is in your chat history.'
                : 'Background research task finished without a report.');
        return report;
    };
}
