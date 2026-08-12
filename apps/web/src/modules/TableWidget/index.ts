/**
 * TableWidget — the refresh-aware `data-table` renderer (#349).
 *
 * Tables were the last visualization delivered as a terminal snapshot: two
 * divergent render paths (core's `DataTableBlock` for inline rows, the web
 * `QueryResultDataBlock` for handle-backed ones), neither of which received
 * the render `ctx` that carries a block's server-addressable `BlockRef`. This
 * module collapses both into one widget that reads its `BlockRef`, hydrates
 * from the handle snapshot when needed, and reconciles through
 * `useWidgetRefresh` exactly as the map and chart widgets do.
 *
 * `registerTableBlockRenderer()` (called at web bootstrap) plugs it into
 * core's open block-renderer registry, overriding the built-in default.
 */

export { TableWidget, TableWidgetUI } from "./TableWidget.component";
export type {
  TableWidgetProps,
  TableWidgetUIProps,
} from "./TableWidget.component";

export {
  TableWidgetGate,
  TableWidgetPlaceholderUI,
} from "./TableWidgetGate.component";
export type {
  TableWidgetGateProps,
  TableWidgetPlaceholderUIProps,
} from "./TableWidgetGate.component";

export { registerTableBlockRenderer } from "./utils/register.util";
