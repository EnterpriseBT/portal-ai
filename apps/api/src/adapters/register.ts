/**
 * Register all connector adapters.
 *
 * Call {@link registerAdapters} once at application startup to populate
 * the {@link ConnectorAdapterRegistry} with all available adapters.
 */

import { ConnectorAdapterRegistry } from "./adapter.registry.js";
import { csvAdapter } from "./csv/csv.adapter.js";

export function registerAdapters(): void {
  ConnectorAdapterRegistry.register("csv", csvAdapter);
}
