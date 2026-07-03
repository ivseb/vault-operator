/**
 * ONNX-runtime pre-registration for the reranker bundle.
 *
 * @huggingface/transformers picks its ONNX backend at MODULE-INIT time
 * (node_modules/@huggingface/transformers/src/backends/onnx.js:105):
 *
 *     if (ORT_SYMBOL in globalThis) { ONNX = globalThis[ORT_SYMBOL]; }
 *     else if (apis.IS_NODE_ENV)   { ONNX = ONNX_NODE; ... }
 *
 * Electron's renderer exposes process.versions.node, so IS_NODE_ENV is
 * true and transformers falls back to onnxruntime-node -- a native binding
 * whose env has no `.wasm`, which silently disables the reranker
 * ("ONNX WASM backend not available even after onnxruntime-web pre-load").
 *
 * Setting globalThis[Symbol.for('onnxruntime')] to the plain onnxruntime-web
 * /wasm build BEFORE transformers initializes makes transformers use it.
 * This module is imported FIRST by reranker-entry.ts; ESM evaluates entry
 * imports depth-first in source order, so this side effect runs before the
 * @huggingface/transformers import evaluates. The main-bundle build used to
 * do this via a dynamic import in RerankerService (which controlled the
 * order); once transformers moved into this separate bundle, the ordering
 * had to move in with it.
 */

/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- runtime subpath has no type declarations (import is error-typed); global assignment is the documented ORT-selection hook */
// @ts-ignore -- runtime subpath, no type declarations resolvable for /wasm
import * as ortWasm from 'onnxruntime-web/wasm';

(globalThis as any)[Symbol.for('onnxruntime')] = ortWasm;
/* eslint-enable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

export { ortWasm };
