/**
 * CreateDrawioTool
 *
 * Creates a Draw.io / diagrams.net flowchart file (.drawio) programmatically.
 * The format is hand-authored mxGraph XML wrapped in mxfile — the
 * drawio-obsidian (zapthedingbat) and obsidian-diagrams-net (jensmtg) plugins
 * both accept this format and open it for further editing.
 *
 * Why this exists: the LLM kept producing .drawio.svg via write_file with
 * hallucinated mxfile wrappers, and the plugin rejected the files as
 * "Not a diagram file" (BUG-018). This tool knows the valid minimum shape,
 * so the plugin opens the file cleanly.
 *
 * Supported: vertices (labeled boxes, colors, auto-layout in a column or row)
 * and edges (arrows between vertices). Advanced features (swimlanes, custom
 * shape libraries, layers) are out of scope for now — the user can extend
 * the diagram in the plugin's editor after opening the file.
 */

import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';

/* ------------------------------------------------------------------ */
/*  Input schema                                                      */
/* ------------------------------------------------------------------ */

interface DrawioNodeInput {
    /** Stable identifier the user references from edges. Required. */
    id: string;
    /** Text shown in the box. Required. */
    label: string;
    /** Color name or #hex. Optional — default blue. */
    color?: string;
    /** Shape style — default "rounded" rectangle. */
    shape?: 'rounded' | 'rectangle' | 'ellipse' | 'rhombus';
}

interface DrawioEdgeInput {
    /** Source node id. */
    from: string;
    /** Target node id. */
    to: string;
    /** Optional edge label (e.g. "yes" / "no" branches). */
    label?: string;
}

/* ------------------------------------------------------------------ */
/*  Color + style helpers                                             */
/* ------------------------------------------------------------------ */

const COLOR_MAP: Record<string, { fill: string; stroke: string }> = {
    blue:   { fill: '#dae8fc', stroke: '#6c8ebf' },
    green:  { fill: '#d5e8d4', stroke: '#82b366' },
    yellow: { fill: '#fff2cc', stroke: '#d6b656' },
    red:    { fill: '#f8cecc', stroke: '#b85450' },
    purple: { fill: '#e1d5e7', stroke: '#9673a6' },
    orange: { fill: '#ffe6cc', stroke: '#d79b00' },
    gray:   { fill: '#f5f5f5', stroke: '#666666' },
    cyan:   { fill: '#c5e7f5', stroke: '#4d9ab8' },
    white:  { fill: '#ffffff', stroke: '#000000' },
};

function resolveColors(name?: string): { fill: string; stroke: string } {
    if (!name) return COLOR_MAP.blue;
    const lower = name.toLowerCase();
    if (COLOR_MAP[lower]) return COLOR_MAP[lower];
    // Accept #hex — mxGraph accepts it directly, pair with a plain black stroke.
    if (/^#[0-9a-f]{3,8}$/i.test(name)) return { fill: name, stroke: '#000000' };
    return COLOR_MAP.blue;
}

function vertexStyle(shape: DrawioNodeInput['shape'], fill: string, stroke: string): string {
    const shapePart =
        shape === 'rectangle' ? 'rounded=0;whiteSpace=wrap;html=1;' :
        shape === 'ellipse' ? 'ellipse;whiteSpace=wrap;html=1;' :
        shape === 'rhombus' ? 'rhombus;whiteSpace=wrap;html=1;' :
        'rounded=1;whiteSpace=wrap;html=1;';
    return `${shapePart}fillColor=${fill};strokeColor=${stroke};fontSize=12;`;
}

const EDGE_STYLE =
    'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;';

/* ------------------------------------------------------------------ */
/*  XML helpers                                                       */
/* ------------------------------------------------------------------ */

function xmlAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------------ */
/*  Layout                                                            */
/* ------------------------------------------------------------------ */

interface Position { x: number; y: number; width: number; height: number }

function layoutVertices(
    nodes: DrawioNodeInput[],
    layout: 'column' | 'row',
): Map<string, Position> {
    const BOX_W = 160;
    const BOX_H = 50;
    const GAP = 40;
    const positions = new Map<string, Position>();
    if (layout === 'row') {
        nodes.forEach((n, i) => {
            positions.set(n.id, { x: 80 + i * (BOX_W + GAP), y: 80, width: BOX_W, height: BOX_H });
        });
    } else {
        nodes.forEach((n, i) => {
            positions.set(n.id, { x: 160, y: 80 + i * (BOX_H + GAP), width: BOX_W, height: BOX_H });
        });
    }
    return positions;
}

/* ------------------------------------------------------------------ */
/*  Tool class                                                        */
/* ------------------------------------------------------------------ */

export class CreateDrawioTool extends BaseTool<'create_drawio'> {
    readonly name = 'create_drawio' as const;
    readonly isWriteOperation = true;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'create_drawio',
            description:
                'Create a Draw.io / diagrams.net flowchart (.drawio file) with labeled boxes and arrows. ' +
                'The file is fully editable in the drawio-obsidian or obsidian-diagrams-net plugin afterwards. ' +
                'NEVER use write_file to create .drawio or .drawio.svg files — the format requires a specific mxfile wrapper ' +
                'that write_file will reject.',
            input_schema: {
                type: 'object',
                properties: {
                    output_path: {
                        type: 'string',
                        description: 'Path for the diagram file. Must end with .drawio (e.g. "Diagrams/workflow.drawio").',
                    },
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', description: 'Stable id referenced from edges.' },
                                label: { type: 'string', description: 'Text shown in the box.' },
                                color: { type: 'string', description: 'blue, green, yellow, red, purple, orange, gray, cyan, white, or #hex. Default: blue.' },
                                shape: { type: 'string', enum: ['rounded', 'rectangle', 'ellipse', 'rhombus'], description: 'Default: rounded.' },
                            },
                            required: ['id', 'label'],
                        },
                        description: 'Boxes in the flowchart (max 30).',
                    },
                    edges: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                from: { type: 'string', description: 'Source node id.' },
                                to: { type: 'string', description: 'Target node id.' },
                                label: { type: 'string', description: 'Optional edge label, e.g. "yes" / "no".' },
                            },
                            required: ['from', 'to'],
                        },
                        description: 'Arrows connecting the boxes.',
                    },
                    layout: {
                        type: 'string',
                        enum: ['column', 'row'],
                        description: '"column" (vertical, default) or "row" (horizontal).',
                    },
                },
                required: ['output_path', 'nodes'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;
        const outputPath = ((input.output_path as string) ?? '').trim();
        const nodesRaw = Array.isArray(input.nodes) ? (input.nodes as DrawioNodeInput[]) : [];
        const edgesRaw = Array.isArray(input.edges) ? (input.edges as DrawioEdgeInput[]) : [];
        const layout: 'column' | 'row' = input.layout === 'row' ? 'row' : 'column';

        if (!outputPath) {
            callbacks.pushToolResult(this.formatError(new Error('output_path is required')));
            return;
        }
        if (!outputPath.endsWith('.drawio')) {
            callbacks.pushToolResult(
                this.formatError(new Error('output_path must end with .drawio (no .svg / .png suffix).')),
            );
            return;
        }
        if (nodesRaw.length === 0) {
            callbacks.pushToolResult(this.formatError(new Error('At least one node is required.')));
            return;
        }
        if (nodesRaw.length > 30) {
            callbacks.pushToolResult(this.formatError(new Error('Maximum 30 nodes per diagram — split larger flows into multiple files.')));
            return;
        }

        const nodes = nodesRaw.slice(0, 30);
        const nodeIds = new Set(nodes.map((n) => n.id));
        const edges = edgesRaw.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
        const droppedEdges = edgesRaw.length - edges.length;

        const positions = layoutVertices(nodes, layout);

        // ── Build mxGraphModel ──────────────────────────────────────────────
        // Cell id 0 is the graph root, id 1 is the default layer. User cells
        // start at id 2. Required structure — deviations break the plugin.
        const cellParts: string[] = [
            '<mxCell id="0" />',
            '<mxCell id="1" parent="0" />',
        ];

        let cellId = 2;
        const idMap = new Map<string, string>();

        for (const node of nodes) {
            const pos = positions.get(node.id)!;
            const { fill, stroke } = resolveColors(node.color);
            const style = vertexStyle(node.shape, fill, stroke);
            const mxId = String(cellId++);
            idMap.set(node.id, mxId);
            cellParts.push(
                `<mxCell id="${mxId}" value="${xmlAttr(node.label)}" style="${xmlAttr(style)}" vertex="1" parent="1">` +
                    `<mxGeometry x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" as="geometry" />` +
                    `</mxCell>`,
            );
        }

        for (const edge of edges) {
            const srcMx = idMap.get(edge.from);
            const dstMx = idMap.get(edge.to);
            if (!srcMx || !dstMx) continue;
            const mxId = String(cellId++);
            const labelAttr = edge.label ? ` value="${xmlAttr(edge.label)}"` : '';
            cellParts.push(
                `<mxCell id="${mxId}"${labelAttr} style="${xmlAttr(EDGE_STYLE)}" edge="1" source="${srcMx}" target="${dstMx}" parent="1">` +
                    `<mxGeometry relative="1" as="geometry" />` +
                    `</mxCell>`,
            );
        }

        const cells = cellParts.join('');
        const now = new Date().toISOString();
        const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<mxfile host="Obsidian" modified="${now}" agent="obsilo-agent" version="1.0" type="device">`,
            '<diagram name="Page-1" id="obsilo-main">',
            '<mxGraphModel dx="900" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
            '<root>',
            cells,
            '</root>',
            '</mxGraphModel>',
            '</diagram>',
            '</mxfile>',
        ].join('');

        // ── Write via Obsidian API (binary-safe, path-validated) ───────────
        try {
            const existing = this.app.vault.getAbstractFileByPath(outputPath);
            if (existing) {
                // Overwrite
                const { TFile } = await import('obsidian');
                if (!(existing instanceof TFile)) {
                    throw new Error(`Path exists but is not a file: ${outputPath}`);
                }
                await this.app.vault.modify(existing, xml);
            } else {
                // Create
                const lastSlash = outputPath.lastIndexOf('/');
                if (lastSlash > 0) {
                    const dir = outputPath.slice(0, lastSlash);
                    await this.app.vault.createFolder(dir).catch(() => { /* already exists */ });
                }
                await this.app.vault.create(outputPath, xml);
            }

            const edgeHint = droppedEdges > 0
                ? ` (dropped ${droppedEdges} edge(s) with unknown node ids)`
                : '';
            callbacks.pushToolResult(
                this.formatSuccess(
                    `Created ${outputPath} with ${nodes.length} node(s) and ${edges.length} edge(s)${edgeHint}. ` +
                        `Open the file in Obsidian — the Diagrams plugin renders it automatically and lets the user extend the flow in the editor.`,
                ),
            );
        } catch (error) {
            await callbacks.handleError('create_drawio', error);
            callbacks.pushToolResult(this.formatError(error));
        }
    }
}
