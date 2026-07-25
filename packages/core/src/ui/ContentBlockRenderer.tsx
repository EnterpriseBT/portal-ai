import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  PortalMessageBlock,
  MutationResultContentBlock,
} from "../contracts/portal.contract.js";
import { DataTableBlock } from "./DataTableBlock.js";
import { MutationResultBlock } from "./MutationResultBlock.js";

// ── Renderer registry (#121 child H) ────────────────────────────────
//
// Display routing is an OPEN set: each block type (the projection of a
// tool's `resultKind`) maps to a renderer here, and a new format —
// a D3-backed graph, a GIS map (#84) — is added by REGISTERING a renderer,
// with no edit to a central switch. `ContentBlockRenderer` is the single
// `block.type`-agnostic dispatch; it just looks the renderer up.

/** Renders one display block. Returns null when there's nothing to show. */
export type BlockRenderer = (block: PortalMessageBlock) => React.ReactNode;

const renderText: BlockRenderer = (block) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>
    {String(block.content ?? "")}
  </ReactMarkdown>
);

const renderDataTable: BlockRenderer = (block) => {
  const raw = (block.content ?? {}) as {
    columns?: string[];
    rows?: Record<string, unknown>[];
  };
  const columns = raw.columns ?? [];
  const rows = raw.rows ?? [];
  return <DataTableBlock columns={columns} rows={rows} />;
};

const renderMutationResult: BlockRenderer = (block) => (
  <MutationResultBlock content={block.content as MutationResultContentBlock} />
);

const blockRenderers = new Map<string, BlockRenderer>([
  ["text", renderText],
  ["data-table", renderDataTable],
  ["mutation-result", renderMutationResult],
]);

/**
 * Register (or override) the renderer for a block type / `resultKind`. New
 * display formats register here — `registerBlockRenderer("d3", …)`,
 * `registerBlockRenderer("geo", …)` — and the central dispatch picks them up
 * with no further change (#121 child H, discovery D7). The portal/agent layer
 * stays format-agnostic; only this web registry learns the format.
 */
export function registerBlockRenderer(
  type: string,
  renderer: BlockRenderer
): void {
  blockRenderers.set(type, renderer);
}

/** Whether a renderer is registered for `type`. */
export function hasBlockRenderer(type: string): boolean {
  return blockRenderers.has(type);
}

export interface ContentBlockRendererProps {
  block: PortalMessageBlock;
}

export const ContentBlockRenderer: React.FC<ContentBlockRendererProps> = ({
  block,
}) => {
  const renderer = blockRenderers.get(block.type);
  if (!renderer) return null;
  return <>{renderer(block)}</>;
};
