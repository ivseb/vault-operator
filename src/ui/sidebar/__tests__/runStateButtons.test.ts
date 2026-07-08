/**
 * FIX-24-08-03 regression tests
 *
 * Live incident 2026-07-08: the user could not stop a running agent task.
 * Root cause chain (3-zone investigation, adversarially verified):
 *
 *   Rank 1: FEAT-24-08 morphed the Stop button INTO the Send button as
 *   soon as text sat in the textarea -- Stop became unreachable mid-run,
 *   the click queued a steering message instead of aborting. No Esc
 *   fallback existed.
 *
 *   Rank 2: after Stop, the old run drains to its next abort checkpoint
 *   and its late onComplete/onError closures nulled currentAbortController
 *   UNCONDITIONALLY -- clobbering the controller of a newer run started in
 *   the drain window, which then became unstoppable.
 *
 * The fix: Stop stays visible whenever a task runs (Send appears next to
 * it in steering mode), Escape stops, completion closures only clean up
 * their own controller, and sends are refused while a stopped task drains.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveRunStateButtons } from '../runStateButtons';

describe('resolveRunStateButtons (FIX-24-08-03)', () => {
    it('idle without text: send only', () => {
        expect(resolveRunStateButtons(false, false)).toEqual({ showSend: true, showStop: false });
    });

    it('idle with text: send only', () => {
        expect(resolveRunStateButtons(false, true)).toEqual({ showSend: true, showStop: false });
    });

    it('running without text: stop only', () => {
        expect(resolveRunStateButtons(true, false)).toEqual({ showSend: false, showStop: true });
    });

    it('running with text (steering): BOTH visible -- stop must never disappear mid-run', () => {
        expect(resolveRunStateButtons(true, true)).toEqual({ showSend: true, showStop: true });
    });
});

describe('stop-chain source pins (FIX-24-08-03)', () => {
    const sidebarSource = fs.readFileSync(
        path.resolve(__dirname, '../../AgentSidebarView.ts'),
        'utf-8',
    );

    it('refreshRunStateButtons uses resolveRunStateButtons', () => {
        expect(sidebarSource).toMatch(/resolveRunStateButtons\(/);
    });

    it('Escape stops a running task from the textarea', () => {
        expect(sidebarSource).toMatch(/e\.key === 'Escape'[\s\S]{0,200}handleStop\(\)/);
    });

    it('completion closures only clean up their own controller (identity check)', () => {
        const matches = sidebarSource.match(/this\.currentAbortController === myController/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2); // onComplete + onError
    });

    it('handleSendMessage refuses new runs while a stopped task drains', () => {
        expect(sidebarSource).toMatch(/if \(this\.taskDraining\)[\s\S]{0,200}taskStillStopping/);
    });

    it('approval cards bind the run signal, not the mutable controller field', () => {
        expect(sidebarSource).toMatch(/abortSignal: this\.lastRunAbortSignal/);
    });

    it('AgentTask forwards consumeSteeringMessages into subtask callbacks', () => {
        const agentTaskSource = fs.readFileSync(
            path.resolve(__dirname, '../../../core/AgentTask.ts'),
            'utf-8',
        );
        // Two wiring sites: the engine ports (parent loop drain) and the
        // subtask callbacks (child loop drain while the parent parks in
        // await spawnSubtask). Only the second one is the FIX-24-08-03 gap.
        const matches = agentTaskSource.match(
            /consumeSteeringMessages: this\.taskCallbacks\.consumeSteeringMessages/g,
        ) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('main.ts stops the background runner on unload', () => {
        const mainSource = fs.readFileSync(
            path.resolve(__dirname, '../../../main.ts'),
            'utf-8',
        );
        expect(mainSource).toMatch(/onunload[\s\S]{0,2000}backgroundTaskRunner\?\.stop\(\)/);
    });
});

/**
 * IMP-24-08-04: Stop is a PAUSE, not a kill. The aborted run keeps its
 * inflight snapshot (instead of clearing it in the finally), flushes the
 * debounced write so the snapshot is on disk, and the sidebar offers a
 * Resume card right after the stopped run drains. handleStop also gives
 * immediate visual feedback instead of letting the Working spinner run
 * until the drain ends.
 */
describe('stop=pause source pins (IMP-24-08-04)', () => {
    const sidebarSource = fs.readFileSync(
        path.resolve(__dirname, '../../AgentSidebarView.ts'),
        'utf-8',
    );
    const agentTaskSource = fs.readFileSync(
        path.resolve(__dirname, '../../../core/AgentTask.ts'),
        'utf-8',
    );

    it('AgentTask keeps the inflight snapshot when the run was aborted', () => {
        expect(agentTaskSource).toMatch(/loopState\.phase !== 'failed' && !abortSignal\?\.aborted/);
    });

    it('AgentTask flushes the pending snapshot on abort so Resume sees it', () => {
        expect(agentTaskSource).toMatch(/flushNow/);
    });

    it('AgentTask grades the abort exit with phase aborted (forensics)', () => {
        expect(agentTaskSource).toMatch(/loopState\.phase = 'aborted'/);
    });

    it('sidebar offers the resume card after a stopped run drains', () => {
        expect(sidebarSource).toMatch(/myController\.signal\.aborted[\s\S]{0,300}maybeOfferInflightResume/);
    });

    it('handleStop gives immediate visual feedback (spinner -> stopping row)', () => {
        expect(sidebarSource).toMatch(/handleStop\(\): void \{[\s\S]{0,400}currentStopFeedback/);
    });
});
