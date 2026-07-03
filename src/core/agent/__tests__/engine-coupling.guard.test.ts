import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Engine-Coupling Lint Guard (ADR-145 enforcement, modeled on the
 * ADR-080 memory guard).
 *
 * The agent-loop package (src/core/agent/) works against ports and the
 * serializable AgentLoopState -- never against the AgentTask facade or
 * Obsidian directly. That boundary is what makes the engine testable
 * without an Obsidian mock and keeps a future extraction a directory
 * move. This test fails the suite if anybody couples the engine back to
 * the host:
 *
 *  - no file may import AgentTask (the facade depends on the engine,
 *    never the reverse). Exemption: AgentTaskRunner.ts IS the host-side
 *    runner and legitimately constructs AgentTask.
 *  - no file may import 'obsidian'.
 *  - interceptors must not VALUE-import the ToolExecutionPipeline --
 *    tool dispatch reaches them through ports. `import type` is fine
 *    (erased at compile time).
 */

const AGENT_DIR = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['__tests__']);
const RUNNER_EXEMPT = 'AgentTaskRunner.ts';

const OBSIDIAN_IMPORT = /from\s+['"]obsidian['"]|require\s*\(\s*['"]obsidian['"]\s*\)/;
const AGENTTASK_IMPORT = /from\s+['"][^'"]*\/AgentTask['"]/;
/** Value import of the pipeline (import type is allowed). */
const PIPELINE_VALUE_IMPORT = /import\s+(?!type\b)[^;]*from\s+['"][^'"]*ToolExecutionPipeline['"]/;

function listFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            out.push(...listFiles(path.join(dir, entry.name)));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

function offendersOf(files: string[], pattern: RegExp, exempt?: string): string[] {
    const offenders: string[] = [];
    for (const file of files) {
        if (exempt && path.basename(file) === exempt) continue;
        if (pattern.test(fs.readFileSync(file, 'utf-8'))) {
            offenders.push(path.relative(process.cwd(), file));
        }
    }
    return offenders;
}

describe('Engine-Coupling Lint Guard (ADR-145)', () => {
    const files = listFiles(AGENT_DIR);

    it('no source file in src/core/agent/ imports the AgentTask facade (except the runner)', () => {
        const offenders = offendersOf(files, AGENTTASK_IMPORT, RUNNER_EXEMPT);
        expect(offenders, `Engine must not depend on the facade -- use ports/state instead:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('no source file in src/core/agent/ imports obsidian', () => {
        const offenders = offendersOf(files, OBSIDIAN_IMPORT);
        expect(offenders, `Engine must stay obsidian-free -- host feedback goes through ports:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('no interceptor value-imports the ToolExecutionPipeline', () => {
        const interceptorFiles = files.filter((f) => f.includes(`${path.sep}interceptors${path.sep}`));
        const offenders = offendersOf(interceptorFiles, PIPELINE_VALUE_IMPORT);
        expect(offenders, `Interceptors reach tool dispatch through ports, never the pipeline directly:\n${offenders.join('\n')}`).toEqual([]);
    });
});
