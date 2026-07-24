/**
 * D3Widget — the sandboxed D3 render runtime (#268, epic #267).
 *
 * Agent-authored render programs (see `D3BlockContentSchema` in
 * `@portalai/core/contracts`) execute inside an `allow-scripts`-only
 * iframe with a no-egress CSP; data, params, and theme cross a
 * nonce-validated postMessage bridge, with large results paged in
 * progressively. `registerD3BlockRenderer()` (called at web bootstrap)
 * plugs the widget into core's open block-renderer registry.
 */

export { D3Widget, D3WidgetUI } from "./D3Widget.component";
export type { D3WidgetProps, D3WidgetUIProps } from "./D3Widget.component";

export { D3SandboxFrameUI } from "./D3SandboxFrame.component";
export type { D3SandboxFrameUIProps } from "./D3SandboxFrame.component";

export { registerD3BlockRenderer } from "./utils/register.util";

export {
  BRIDGE_PROTOCOL_VERSION,
  D3_SNAPSHOT_PAGE_SIZE,
  RENDER_TIMEOUT_MS,
  SandboxOutMessageSchema,
  createSandboxBridge,
} from "./utils/bridge.util";
export type {
  SandboxBridge,
  SandboxBridgeCallbacks,
  SandboxBridgeInit,
  SandboxOutMessage,
} from "./utils/bridge.util";

export {
  SANDBOX_CSP,
  SANDBOX_SRCDOC,
  buildSandboxSrcdoc,
} from "./utils/sandbox-srcdoc.util";

export { buildSandboxTheme } from "./utils/sandbox-theme.util";
export type { D3SandboxTheme } from "./utils/sandbox-theme.util";

export { useProgressiveHandleRows } from "./utils/progressive-rows.util";
export type {
  ProgressiveBatch,
  ProgressiveRowsState,
} from "./utils/progressive-rows.util";
