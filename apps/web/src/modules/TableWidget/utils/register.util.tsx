import { registerBlockRenderer } from "@portalai/core";

import { TableWidgetGate } from "../TableWidgetGate.component";

/**
 * Registers the refresh-aware table renderer for `data-table` blocks (#349),
 * overriding core's built-in `renderDataTable`.
 *
 * Core's default stays in place for core-only consumers (its own Storybook),
 * which have no SDK to fetch a snapshot with. Called once from web bootstrap
 * (`main.tsx`); idempotent.
 *
 * Registering here is what gives a table its `ctx` — and therefore its
 * `blockRef` — which the retired `renderWebBlock` data-table arm dropped.
 */
export function registerTableBlockRenderer(): void {
  registerBlockRenderer("data-table", (block, ctx) => (
    <TableWidgetGate
      content={block.content}
      blockRef={ctx?.blockRef}
      dataUpdatedAt={ctx?.dataUpdatedAt}
    />
  ));
}
