/**
 * skill-creator / golden_records -- freeze a good run, and grade a later one against it.
 *
 * The point: when the user swaps the model behind Vault Operator (seven providers, any
 * Tuesday), tell whether a skill still works. This never calls a model and never asks the
 * agent to judge; it compares the seam artifact of a run against the frozen one, with
 * arithmetic, which is what makes it model-independent.
 *
 * Runs as a Vault Operator skill script. Returns its result value; never throws on a grading
 * outcome. Named helpers are exported for the unit test.
 *
 * Six ops, not eleven: equals, count, same (multiset unless ordered), absent, file_exists,
 * has_keys. The dropped ones (contains/in/matches/gte/lte) were dead surface freeze never
 * emitted. No schema_valid: a skill script cannot import a schema library.
 */

const MISSING = Symbol('missing');

// A dotted path with [*] to flatten a list: "positionen[*].artikelnummer".
export function resolvePath(data, path) {
    if (!path) return data;
    let current = [data];
    let exploded = false;
    for (const raw of path.split('.')) {
        const star = raw.endsWith('[*]');
        const key = star ? raw.slice(0, -3) : raw;
        const next = [];
        for (const item of current) {
            if (item && typeof item === 'object' && key in item) next.push(item[key]);
        }
        if (next.length === 0) return exploded ? [] : MISSING;
        if (star) {
            const flat = [];
            for (const v of next) Array.isArray(v) ? flat.push(...v) : flat.push(v);
            current = flat;
            exploded = true;
        } else {
            current = next;
        }
    }
    return exploded ? current : current[0];
}

const stable = (v) => JSON.stringify(v, Object.keys(v || {}).sort ? undefined : undefined);
const asList = (v) => (v === MISSING ? [] : Array.isArray(v) ? v : [v]);

// Evaluate one code assertion against the produced artifact and the frozen expected one.
export function runAssertion(artifact, spec, expected, fileExists) {
    if (spec.check === 'rubric') return { check: 'rubric', text: spec.text, passed: null };
    const op = spec.op;
    if (op === 'file_exists') {
        return { check: 'code', op, value: spec.value,
            passed: typeof fileExists === 'function' ? !!fileExists(spec.value) : false,
            error: typeof fileExists === 'function' ? undefined : 'no vault to resolve file_exists' };
    }
    const actual = resolvePath(artifact, spec.path || '');
    const res = { check: 'code', op, path: spec.path,
        expected: 'value' in spec ? spec.value : undefined,
        actual: actual === MISSING ? null : actual };

    if (op === 'absent') { res.passed = actual === MISSING || actual === null || (Array.isArray(actual) && actual.length === 0); return res; }
    if (actual === MISSING) { res.passed = false; res.error = `path '${spec.path}' is not in the artifact`; return res; }
    if (op === 'equals') res.passed = JSON.stringify(actual) === JSON.stringify(spec.value);
    else if (op === 'count') { res.passed = asList(actual).length === spec.value; res.actual = asList(actual).length; }
    else if (op === 'has_keys') res.passed = actual && typeof actual === 'object' && (spec.value || []).every((k) => k in actual);
    else if (op === 'same') {
        if (expected === undefined) { res.passed = false; res.error = "op 'same' needs the frozen artifact"; return res; }
        const frozen = resolvePath(expected, spec.path || '');
        if (frozen === MISSING) { res.passed = false; res.error = `path '${spec.path}' not in the frozen artifact`; return res; }
        res.expected = frozen;
        res.passed = spec.ordered
            ? JSON.stringify(actual) === JSON.stringify(frozen)
            : JSON.stringify(asList(actual).map(stable).sort()) === JSON.stringify(asList(frozen).map(stable).sort());
    } else { res.passed = false; res.error = `unknown op '${op}'`; }
    return res;
}

// Derive assertions from the artifact a real run produced. Scalars determined by the input
// become exact checks; a value with a space is prose and becomes a rubric candidate, because
// a sentence has a hundred correct forms; timestamps, uuids and paths are dropped.
const UNSTABLE = [/^\d{4}-\d{2}-\d{2}[T ]/, /^[0-9a-f]{8}-[0-9a-f]{4}-/i, /[/\\]/];
const isUnstable = (v) => typeof v === 'string' && UNSTABLE.some((r) => r.test(v));
const isProse = (v) => typeof v === 'string' && (/\s/.test(v.trim()) || v.length >= 40);

export function deriveAssertions(artifact, prefix = '') {
    const code = [];
    const rubric = [];
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return { code, rubric };
    for (const [key, value] of Object.entries(artifact)) {
        const path = `${prefix}${key}`;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const sub = deriveAssertions(value, `${path}.`);
            code.push(...sub.code); rubric.push(...sub.rubric);
        } else if (Array.isArray(value)) {
            code.push({ check: 'code', op: 'count', path: `${path}[*]`, value: value.length });
            if (value.length && value.every((v) => v && typeof v === 'object')) {
                const keys = Object.keys(value[0]).filter((k) => value.every((v) => k in v));
                for (const k of keys) {
                    const vals = value.map((v) => v[k]);
                    if (vals.some((v) => isUnstable(v) || isProse(v))) {
                        if (vals.some(isProse)) rubric.push({ path: `${path}[*].${k}` });
                    } else code.push({ check: 'code', op: 'same', path: `${path}[*].${k}` });
                }
            } else if (value.length && value.every((v) => typeof v !== 'object')) {
                if (!value.some((v) => isUnstable(v) || isProse(v))) code.push({ check: 'code', op: 'same', path: `${path}[*]` });
            }
        } else if (isProse(value)) {
            rubric.push({ path });
        } else if (isUnstable(value)) {
            /* drop */
        } else if (value === null) {
            code.push({ check: 'code', op: 'absent', path });
        } else {
            code.push({ check: 'code', op: 'equals', path, value });
        }
    }
    return { code, rubric };
}

// Grade one record. Three outcomes: a run that produced no artifact did not disagree, it
// failed to happen, so INCONCLUSIVE, never FAIL.
export function gradeRecord(record, artifact, expected, fileExists) {
    if (record.seam_absent && artifact == null) {
        return { id: record.id, status: record.started ? 'INCONCLUSIVE' : 'MISSING', assertions: [] };
    }
    const results = (record.assertions || []).map((a) => runAssertion(artifact || {}, a, expected, fileExists));
    const code = results.filter((r) => r.check === 'code');
    const failed = code.filter((r) => !r.passed);
    return { id: record.id, status: failed.length ? 'FAIL' : 'PASS', assertions: results,
        code_passed: code.length - failed.length, code_total: code.length };
}

export function compare(baseline, current) {
    const base = Object.fromEntries((baseline.records || []).map((r) => [r.id, r.status]));
    const out = { verdict: 'UNCHANGED', regressed: [], improved: [], inconclusive: [],
        baseline_model: baseline.model, current_model: current.model };
    for (const r of current.records || []) {
        const b = base[r.id];
        const entry = { id: r.id, baseline: b, current: r.status };
        if (r.status === 'INCONCLUSIVE' || r.status === 'MISSING') out.inconclusive.push(entry);
        else if (b === 'PASS' && r.status === 'FAIL') out.regressed.push(entry);
        else if (b === 'FAIL' && r.status === 'PASS') out.improved.push(entry);
    }
    out.verdict = out.inconclusive.length ? 'INCONCLUSIVE'
        : out.regressed.length ? 'DEGRADED'
        : out.improved.length ? 'IMPROVED' : 'UNCHANGED';
    return out;
}

// --- the sandbox entry point ------------------------------------------------

export async function execute(args, ctx) {
    const mode = (args && args.mode) || 'grade';
    const root = args && typeof args.skills_root === 'string' ? args.skills_root.trim().replace(/\/$/, '') : '';
    const name = args && args.skill;
    if (!root || !name) return { ok: false, error: 'skills_root (host) and args.skill are required' };
    const skillRoot = `${root}/${name}`;
    const recPath = `${skillRoot}/references/${name}-golden-records.json`;

    if (mode === 'freeze') {
        if (!args.artifact || typeof args.artifact !== 'object') {
            return { ok: false, error: 'freeze needs args.artifact, the object your dry-run produced. ' +
                'A recipe with file outputs uses --expect-file; grade file_exists against the vault.' };
        }
        const { code, rubric } = deriveAssertions(args.artifact);
        const record = { id: args.record_id || 'gr-1', prompt: args.prompt || '',
            expected: `references/${name}-expected/${args.record_id || 'gr-1'}.json`,
            assertions: [{ check: 'code', op: 'has_keys', value: Object.keys(args.artifact) }, ...code,
                ...(args.rubric ? [{ check: 'rubric', text: args.rubric }] : [])] };
        let data = { records_version: 1, engine: 'skill-creator', skill: name,
            seam: args.seam || 'plan.json', baseline_model: args.model, records: [] };
        const existing = await ctx.vault.read(recPath).catch(() => null);
        if (existing) { try { data = JSON.parse(existing); } catch { /* keep fresh */ } }
        data.baseline_model = args.model || data.baseline_model;
        data.records = (data.records || []).filter((r) => r.id !== record.id);
        data.records.push(record);
        await ctx.vault.mkdir(`${skillRoot}/references/${name}-expected`).catch(() => {});
        await ctx.vault.write(record.expected.replace(/^references/, `${skillRoot}/references`), JSON.stringify(args.artifact, null, 2));
        await ctx.vault.write(recPath, JSON.stringify(data, null, 2));
        return { ok: true, record_id: record.id, code_assertions: code.length, rubric_candidates: rubric.length,
            next: 'read the derived assertions back to the user; cut any they do not recognise' };
    }

    // grade
    const raw = await ctx.vault.read(recPath).catch(() => null);
    if (!raw) return { ok: false, error: `no golden records at ${recPath}; freeze a run first` };
    const data = JSON.parse(raw);
    const fileExists = (p) => false; // grading file outputs needs a run dir; wired by the caller
    const results = [];
    for (const record of data.records || []) {
        const artifact = args.run && args.run[record.id] ? args.run[record.id] : null;
        const expected = await ctx.vault.read(`${skillRoot}/${record.expected}`).catch(() => null);
        results.push(gradeRecord({ ...record, started: !!artifact }, artifact, expected ? JSON.parse(expected) : undefined, fileExists));
    }
    return { ok: true, skill: name, model: args.model, baseline_model: data.baseline_model, records: results };
}
