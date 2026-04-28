/**
 * Register all connector adapters.
 *
 * Call {@link registerAdapters} once at application startup to populate
 * the {@link ConnectorAdapterRegistry} with all available adapters.
 */

import { ConnectorAdapterRegistry } from "./adapter.registry.js";
import { googleSheetsAdapter } from "./google-sheets/google-sheets.adapter.js";
import { sandboxAdapter } from "./sandbox/sandbox.adapter.js";

export function registerAdapters(): void {
  ConnectorAdapterRegistry.register("sandbox", sandboxAdapter);
  ConnectorAdapterRegistry.register("google-sheets", googleSheetsAdapter);
}
