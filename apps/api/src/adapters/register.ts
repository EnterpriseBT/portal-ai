/**
 * Register all connector adapters.
 *
 * Call {@link registerAdapters} once at application startup to populate
 * the {@link ConnectorAdapterRegistry} with all available adapters and
 * to wire RestApiAdapter's process-level deps (probe cache + AI-assist
 * classifier). Tests can call this and then override individual deps
 * via `configureRestApiAdapterDeps`.
 */

import type { DiscoverColumnsResult } from "@portalai/core/contracts";

import { ConnectorAdapterRegistry } from "./adapter.registry.js";
import { googleSheetsAdapter } from "./google-sheets/google-sheets.adapter.js";
import { microsoftExcelAdapter } from "./microsoft-excel/microsoft-excel.adapter.js";
import { sandboxAdapter } from "./sandbox/sandbox.adapter.js";
import { createDefaultClassifier } from "./rest-api/classifier.haiku.js";
import { ProbeCache } from "./rest-api/probe-cache.util.js";
import {
  configureRestApiAdapterDeps,
  restApiAdapter,
} from "./rest-api/rest-api.adapter.js";

export function registerAdapters(): void {
  ConnectorAdapterRegistry.register("sandbox", sandboxAdapter);
  ConnectorAdapterRegistry.register("google-sheets", googleSheetsAdapter);
  ConnectorAdapterRegistry.register("microsoft-excel", microsoftExcelAdapter);
  ConnectorAdapterRegistry.register("rest-api", restApiAdapter);

  // Phase 4: wire the REST API adapter's probe-time deps. One cache
  // singleton + one Haiku-backed classifier per process.
  configureRestApiAdapterDeps({
    cache: new ProbeCache<DiscoverColumnsResult>(),
    classifier: createDefaultClassifier(),
  });
}
