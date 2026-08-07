import { registerBlockRenderer } from "@portalai/core";

import { MapWidgetGate } from "../MapWidgetGate.component";

/**
 * Registers the MapLibre renderer for `geo` blocks in core's open
 * block-renderer registry (#314) — the sibling of `registerD3BlockRenderer`.
 * Called once from web bootstrap (`main.tsx`); idempotent. Statically imports
 * only the light gate — the heavy widget (and `maplibre-gl`) is lazy.
 */
export function registerMapBlockRenderer(): void {
  registerBlockRenderer("geo", (block, ctx) => (
    <MapWidgetGate
      content={block.content}
      blockRef={ctx?.blockRef}
      dataUpdatedAt={ctx?.dataUpdatedAt}
    />
  ));
}
