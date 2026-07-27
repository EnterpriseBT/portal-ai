import { registerBlockRenderer } from "@portalai/core";

import { D3WidgetGate } from "../D3WidgetGate.component";

/**
 * Registers the sandboxed D3 renderer for `d3` blocks in core's open
 * block-renderer registry (#268) — the registry's first real consumer.
 * Called once from web bootstrap (`main.tsx`); idempotent (a repeat call
 * re-registers the same renderer).
 */
export function registerD3BlockRenderer(): void {
  registerBlockRenderer("d3", (block, ctx) => (
    <D3WidgetGate
      content={block.content}
      blockRef={ctx?.blockRef}
      dataUpdatedAt={ctx?.dataUpdatedAt}
    />
  ));
}
