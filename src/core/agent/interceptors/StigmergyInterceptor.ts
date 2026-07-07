/**
 * StigmergyInterceptor (IMP-41-02-01c, contract v2).
 *
 * Stigmergy observability turn as an interceptor. onRunStart consults the
 * daemon BEFORE the user message is pushed to history so pathGuidance can
 * be appended cache-safely (the cached prefix is system + tools schema;
 * the messages tail is not cached). onRunEnd delivers the turn and grades
 * it from the serializable state: end() always, then accept(tokens) for a
 * graded 'accept', abandon() otherwise (binary since the 2026-06-09
 * substrate-starvation RCA -- 'iterate' leaked the response buffer with
 * zero deposits).
 *
 * Phase 1 contract: the adapter NEVER hides a tool -- orderTools only
 * reorders, pathGuidance only emits text in pinned/enforce modes. When
 * the daemon is down or Stigmergy is toggled off, every adapter call is a
 * no-op and the loop runs exactly as before.
 *
 * VO/Stigmergy contract (Cooperation Building Block 2): candidate_ids
 * MUST equal the registered capability set. The mode-filtered tool list
 * excludes deferred tools (FEATURE-1600 / find_tool / progressive
 * disclosure), but those tools ARE registered with the daemon -- consult
 * therefore sees the FULL registered set (registration-superset ==
 * consult-set), while the mode-filtered set keeps driving the prompt-
 * cache `cachedTools` surface the model sees. Stigmergy is RECALL, not a
 * second tool selector.
 *
 * Stays in the facade: pipeline.setStigmergyTurn wiring (host service),
 * the precedence resolver (cross-interceptor concern with FastPath),
 * outcome GRADING at the exit sites (writes serializable state only) and
 * buildStigmergyDecisionSnapshot / episode recording.
 */

import {
    beginStigmergyTurn,
    registerCapabilitiesIfChanged,
    stigmergyMcpId,
    stigmergySkillId,
    stigmergySubagentId,
    type CapabilityDescriptor,
    type McpCapabilityDescriptor,
    type StigmergyTurn,
} from '../../stigmergy/StigmergyAdapter';
import { withTimeout } from '../../utils/withTimeout';
import type { ToolDefinition } from '../../tools/types';
import type { LoopInterceptor, LoopInterceptorContext, RunStartContext } from './types';

export type StigmergyGuidance = ReturnType<StigmergyTurn['pathGuidance']>;

export interface StigmergyPorts {
    taskId: string;
    /** Raw user message reduced via stigmergyPromptOf (host-side). */
    getTurnPrompt(): string;
    /** FULL registered tool set (not mode-filtered; see contract above). */
    getRegisteredTools(): ToolDefinition[];
    /** May throw -- enumeration failures are non-fatal (caught here). */
    getSelfAuthoredSkills(): Array<{ name: string; description: string }>;
    /**
     * User-skill discovery promise, or undefined when no skillsManager is
     * wired. May hang -- the interceptor applies the 1500ms ceiling
     * (FEAT-32-03 PR 3.1, Audit Finding 26).
     */
    discoverUserSkills(): Promise<Array<{ name: string; description: string }>> | undefined;
    /** Allowlist-filtered MCP tools; may throw (caught here). */
    getMcpTools(): McpCapabilityDescriptor[];
    getSubagentProfiles(): CapabilityDescriptor[];
}

export class StigmergyInterceptor implements LoopInterceptor {
    readonly name = 'stigmergy';
    private turn: StigmergyTurn | null = null;
    private guidance: StigmergyGuidance | null = null;
    private descById = new Map<string, string>();

    constructor(private readonly ports: StigmergyPorts) {}

    /** The consult turn (facade binds it to the pipeline dispatch point). */
    getTurn(): StigmergyTurn {
        if (!this.turn) throw new Error('[Stigmergy] getTurn() before onRunStart()');
        return this.turn;
    }

    /** pathGuidance result (precedence resolver + Pre-Activation input). */
    getGuidance(): StigmergyGuidance {
        if (!this.guidance) throw new Error('[Stigmergy] getGuidance() before onRunStart()');
        return this.guidance;
    }

    /** Readable description for a namespaced capability id (all 4 surfaces). */
    getDescriptionFor(id: string): string | undefined {
        return this.descById.get(id);
    }

    async onRunStart(_ctx: RunStartContext): Promise<void> {
        const stigmergyCandidates = this.ports.getRegisteredTools();

        const stigmergySkillsList: CapabilityDescriptor[] = [];
        const seenSkillNames = new Set<string>();
        const addSkill = (name: string, description: string): void => {
            if (!name || seenSkillNames.has(name)) return;
            seenSkillNames.add(name);
            stigmergySkillsList.push({ name, description });
        };
        try {
            for (const s of this.ports.getSelfAuthoredSkills()) {
                addSkill(s.name, s.description);
            }
        } catch (e) {
            console.debug('[Stigmergy] self-authored skill enumeration failed (non-fatal):',
                e instanceof Error ? e.message : e);
        }
        try {
            // FEAT-32-03 PR 3.1: hard 1500ms ceiling on discoverSkills so a
            // haengende user-skill folder cannot block the Stigmergy turn
            // (Audit Finding 26). TimeoutError is logged at debug, self-
            // authored skills already loaded above stay registered.
            const discoverPromise = this.ports.discoverUserSkills();
            const userSkills = discoverPromise
                ? (await withTimeout(discoverPromise, 1500, 'skillsManager.discoverSkills')) ?? []
                : [];
            for (const s of userSkills) addSkill(s.name, s.description);
        } catch (e) {
            console.debug('[Stigmergy] user skill enumeration failed (non-fatal):',
                e instanceof Error ? e.message : e);
        }

        let stigmergyMcpList: McpCapabilityDescriptor[] = [];
        try {
            stigmergyMcpList = this.ports.getMcpTools();
        } catch (e) {
            console.debug('[Stigmergy] mcp tool enumeration failed (non-fatal):',
                e instanceof Error ? e.message : e);
        }

        const stigmergySubagentList = this.ports.getSubagentProfiles();

        await registerCapabilitiesIfChanged({
            tools: stigmergyCandidates,
            skills: stigmergySkillsList,
            mcp: stigmergyMcpList,
            subagents: stigmergySubagentList,
        });

        const stigmergyCandidateIds: string[] = [
            ...stigmergyCandidates.map((t) => t.name),
            ...stigmergySkillsList.map((s) => stigmergySkillId(s.name)),
            ...stigmergyMcpList.map((m) => stigmergyMcpId(m.server, m.name)),
            ...stigmergySubagentList.map((a) => stigmergySubagentId(a.name)),
        ];
        this.turn = await beginStigmergyTurn({
            taskId: this.ports.taskId,
            prompt: this.ports.getTurnPrompt(),
            candidateIds: stigmergyCandidateIds,
        });

        // The descOf map spans all four surfaces so a pinned `skill:*` /
        // `mcp:*` / `subagent:*` id in the guidance text gets a readable
        // description, not a bare id.
        this.descById = new Map<string, string>();
        for (const t of stigmergyCandidates) {
            this.descById.set(t.name, t.description ?? '');
        }
        for (const s of stigmergySkillsList) {
            this.descById.set(stigmergySkillId(s.name), s.description);
        }
        for (const m of stigmergyMcpList) {
            this.descById.set(stigmergyMcpId(m.server, m.name), m.description);
        }
        for (const a of stigmergySubagentList) {
            this.descById.set(stigmergySubagentId(a.name), a.description);
        }
        this.guidance = this.turn.pathGuidance((id) => this.descById.get(id));
    }

    async onRunEnd(ctx: LoopInterceptorContext): Promise<void> {
        if (!this.turn) return;
        // accept and abandon are first-resolver-wins inside the adapter,
        // so re-entry is safe. end() is always called -- it just marks the
        // turn as delivered; the resolution decides what actually happens
        // to the substrate. Grading is binary (see class doc).
        await this.turn.end();
        if (ctx.state.stigmergyOutcome === 'accept') {
            await this.turn.accept(ctx.state.totalInputTokens + ctx.state.totalOutputTokens);
        } else {
            await this.turn.abandon();
        }
    }
}
