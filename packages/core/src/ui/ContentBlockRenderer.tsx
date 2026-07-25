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

/**
 * Optional per-render context threaded to a renderer (#270). `blockRef`
 * identifies a *persisted* block by `{ messageId, blockIndex }` so a renderer
 * (the d3 widget) can call back to the server for that block — e.g. refresh its
 * pipeline. Absent for streaming/unpersisted blocks (nothing to reference yet).
 */
export interface BlockRenderContext {
  blockRef?: { messageId: string; blockIndex: number };
  /** Epoch ms the block's data was produced/persisted (the message's
   *  `created`). A renderer uses it to seed a freshness clock (#270) so a
   *  just-minted widget isn't auto-refreshed while a reopened one is. */
  dataUpdatedAt?: number;
}

/** Renders one display block. Returns null when there's nothing to show. */
export type BlockRenderer = (
  block: PortalMessageBlock,
  ctx?: BlockRenderContext
) => React.ReactNode;

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
  /** Threaded to the renderer as `ctx.blockRef` (#270) — set by the message
   *  view for persisted blocks so a widget can refresh itself. */
  blockRef?: BlockRenderContext["blockRef"];
  /** Threaded as `ctx.dataUpdatedAt` (#270) — the block's data timestamp. */
  dataUpdatedAt?: number;
}

export const ContentBlockRenderer: React.FC<ContentBlockRendererProps> = ({
  block,
  blockRef,
  dataUpdatedAt,
}) => {
  const renderer = blockRenderers.get(block.type);
  if (!renderer) return null;
  return <>{renderer(block, { blockRef, dataUpdatedAt })}</>;
};
