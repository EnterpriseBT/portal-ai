/**
 * Tool Service — orchestrates tool registration for stations.
 *
 * Each tool is defined in its own class under `tools/`. This service
 * builds the full tool set for a station based on its enabled tool packs.
 */

/* global AbortController, fetch */

import { type Tool } from "ai";

import { AnalyticsService } from "./analytics.service.js";
import { DbService } from "./db.service.js";
import {
  wrapWithCostGate,
  type GateableTool,
} from "./cost-gate.service.js";
import { createLogger } from "../utils/logger.util.js";
import type { CostHint } from "@portalai/core/models";

// Tool classes
import { SqlQueryTool } from "../tools/sql-query.tool.js";
import { DisplayEntityRecordsTool } from "../tools/display-entity-records.tool.js";
import { StationContextTool } from "../tools/station-context.tool.js";
import { VisualizeTool } from "../tools/visualize.tool.js";
import { VisualizeTreeTool } from "../tools/visualize-tree.tool.js";
import { ResolveIdentityTool } from "../tools/resolve-identity.tool.js";
import { ClusterTool } from "../tools/cluster.tool.js";
import { HypothesisTestTool } from "../tools/hypothesis-test.tool.js";
import { RegressionTool } from "../tools/regression.tool.js";
import { LogisticRegressionTool } from "../tools/logistic-regression.tool.js";
import { ForecastTool } from "../tools/forecast.tool.js";
import { TechnicalIndicatorTool } from "../tools/technical-indicator.tool.js";
import { NpvTool } from "../tools/npv.tool.js";
import { IrrTool } from "../tools/irr.tool.js";
import { TvmTool } from "../tools/tvm.tool.js";
import { XnpvTool } from "../tools/xnpv.tool.js";
import { XirrTool } from "../tools/xirr.tool.js";
import { DepreciationTool } from "../tools/depreciation.tool.js";
import { VarCvarTool } from "../tools/var-cvar.tool.js";
import { PortfolioMetricsTool } from "../tools/portfolio-metrics.tool.js";
import { BondMathTool } from "../tools/bond-math.tool.js";
import { AmortizeTool } from "../tools/amortize.tool.js";
import { WebSearchTool } from "../tools/web-search.tool.js";
import { WebhookTool } from "../tools/webhook.tool.js";
import { EntityRecordCreateTool } from "../tools/entity-record-create.tool.js";
import { EntityRecordUpdateTool } from "../tools/entity-record-update.tool.js";
import { EntityRecordDeleteTool } from "../tools/entity-record-delete.tool.js";
import { ConnectorEntityCreateTool } from "../tools/connector-entity-create.tool.js";
import { ConnectorEntityUpdateTool } from "../tools/connector-entity-update.tool.js";
import { ConnectorEntityDeleteTool } from "../tools/connector-entity-delete.tool.js";
import { FieldMappingCreateTool } from "../tools/field-mapping-create.tool.js";
import { FieldMappingUpdateTool } from "../tools/field-mapping-update.tool.js";
import { FieldMappingDeleteTool } from "../tools/field-mapping-delete.tool.js";
import { CurrentTimeTool } from "../tools/current-time.tool.js";
import { TransformEntityRecordsTool } from "../tools/transform-entity-records.tool.js";
import { resolveStationCapabilities } from "../utils/resolve-capabilities.util.js";
import { signRequest } from "../utils/webhook-signing.util.js";
import { assertUrlSafeToFetch } from "../utils/url-safety.util.js";
import { environment } from "../environment.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

const logger = createLogger({ module: "tools-service" });

/**
 * Read a fetch response body as text, aborting if the cumulative
 * size exceeds `maxBytes`. Used to prevent a misbehaving toolpack
 * from streaming gigabytes into memory.
 */
async function readResponseTextWithCap(
  response: Response,
  maxBytes: number
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new ApiError(
      502,
      ApiCode.TOOLPACK_RUNTIME_TOO_LARGE,
      `Runtime response exceeds ${maxBytes} bytes`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    // No streaming reader (e.g. test mock returning a synthetic response).
    // Fall back to text() with a post-read size check.
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_RUNTIME_TOO_LARGE,
        `Runtime response exceeds ${maxBytes} bytes`
      );
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore — we're about to throw
      }
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_RUNTIME_TOO_LARGE,
        `Runtime response exceeds ${maxBytes} bytes`
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEBHOOK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookImplementation {
  type: "webhook";
  url: string;
  headers?: Record<string, string>;
  /**
   * Phase-6 per-toolpack HMAC signing secret. When present, every
   * outbound runtime POST is signed (X-Portalai-Timestamp,
   * -Webhook-Id, -Signature: v1=<hex>) so the toolpack server can
   * verify the request came from us. Built-in tools omit this —
   * they're not webhook calls in the same sense.
   */
  signingSecret?: string;
}

/** All recognized tool pack names. */
export const ALL_TOOL_PACKS = [
  "station_context",
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",
] as const;

export type ToolPackName = (typeof ALL_TOOL_PACKS)[number];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** All built-in tool names — used to detect webhook name conflicts. */
export const BUILTIN_TOOL_NAMES = new Set<string>([
  "current_time",
  "station_context",
  "sql_query",
  "display_entity_records",
  "visualize",
  "visualize_tree",
  "resolve_identity",
  "cluster",
  "hypothesis_test",
  "regression",
  "logistic_regression",
  "forecast",
  "technical_indicator",
  "npv",
  "irr",
  "tvm",
  "xnpv",
  "xirr",
  "depreciation",
  "var_cvar",
  "portfolio_metrics",
  "bond_math",
  "amortize",
  "web_search",
  "entity_record_create",
  "entity_record_update",
  "entity_record_delete",
  "connector_entity_create",
  "connector_entity_update",
  "connector_entity_delete",
  "field_mapping_create",
  "field_mapping_update",
  "field_mapping_delete",
  "transform_entity_records",
]);

export class ToolService {
  // -----------------------------------------------------------------------
  // Static look-ups
  // -----------------------------------------------------------------------

  /** Re-exported for any caller still going via the class. */
  static readonly PACK_TOOL_NAMES = BUILTIN_TOOL_NAMES;

  /**
   * Look up a tool's bulkDispatch metadata by name (#85 Phase 4).
   * Returns the metadata + a closed-over executor when:
   *   - the tool exists in the station's analytics tools, AND
   *   - its toolpack descriptor declares `bulkDispatch` metadata.
   * Returns null otherwise; the bulk-transform processor surfaces a
   * typed error to the caller in that case.
   *
   * Resolves built-in toolpacks first, then organization (webhook)
   * toolpacks. A webhook tool can declare `bulkDispatch` on its
   * schema-endpoint definition (see
   * `ToolpackToolDefinitionSchema.bulkDispatch`); when present, the
   * dispatcher uses the runtime endpoint as the executor.
   */
  static async lookupBulkDispatchable(
    toolName: string,
    organizationId: string,
    stationId: string,
    userId: string
  ): Promise<{
    executor: (input: Record<string, unknown>) => Promise<unknown>;
    metadata: import("@portalai/core/registries").BulkDispatchMetadata;
  } | null> {
    // 1. Built-in toolpacks — descriptor inspection only; the
    //    executor goes through the per-station tool registration
    //    (handles auth + injects stationId/orgId/userId).
    const { BUILTIN_TOOLPACKS } = await import(
      "@portalai/core/registries"
    );
    let builtinDescriptor:
      | import("@portalai/core/registries").ToolpackTool
      | null = null;
    for (const pack of BUILTIN_TOOLPACKS) {
      const found = pack.tools.find((t) => t.name === toolName);
      if (found) {
        builtinDescriptor = found;
        break;
      }
    }

    if (builtinDescriptor) {
      if (!builtinDescriptor.bulkDispatch) return null;
      const tools = await ToolService.buildAnalyticsTools(
        organizationId,
        stationId,
        userId
      );
      const aiTool = tools[toolName];
      if (!aiTool) return null;
      const executor = async (input: Record<string, unknown>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (aiTool as any).execute(input, {
          toolCallId: `bulk-dispatch-${Date.now()}`,
          messages: [],
          abortSignal: new AbortController().signal,
        });
      };
      return { executor, metadata: builtinDescriptor.bulkDispatch };
    }

    // 2. Organization (webhook) toolpacks — scan org packs enabled
    //    for this station. The dispatch executor goes through the
    //    runtime endpoint via `callWebhook` (HMAC + auth headers
    //    handled at the seam).
    const stationToolpacks =
      await DbService.repository.stationToolpacks.findByStationId(stationId);
    const orgToolpackIds = stationToolpacks
      .map((r) => r.organizationToolpackId)
      .filter((id): id is string => id !== null);
    if (orgToolpackIds.length === 0) return null;

    const orgToolpacks =
      await DbService.repository.organizationToolpacks.findManyByIds(
        orgToolpackIds,
        { organizationId }
      );

    for (const pack of orgToolpacks) {
      const tool = pack.tools.find((t) => t.name === toolName);
      if (!tool) continue;
      if (!tool.bulkDispatch) return null;
      // `authHeaders` is encrypted-at-rest in the DB type
      // (`string | null`) but the repository decrypts it to a
      // `Record<string, string> | null` on read. The Select-row
      // type signature still claims the raw shape, so cast at the
      // boundary.
      const decryptedHeaders = pack.authHeaders as unknown as
        | Record<string, string>
        | null;
      const implementation: WebhookImplementation = {
        type: "webhook",
        url: pack.endpoints.runtime,
        headers: decryptedHeaders ?? undefined,
        signingSecret: pack.signingSecret,
      };
      const executor = async (input: Record<string, unknown>) => {
        return await ToolService.callWebhook(implementation, {
          tool: toolName,
          input,
        });
      };
      // #121 child I (gate 3): the cost-ack gate reads `costHint` from the
      // tool's declared capability when present, falling back to the legacy
      // `bulkDispatch.costHint`. capability is the taxonomy source of truth.
      const metadata = {
        ...tool.bulkDispatch,
        costHint: tool.capability?.costHint ?? tool.bulkDispatch.costHint,
      };
      return { executor, metadata };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * POST to a webhook URL with auth headers, a 30 s timeout, an
   * SSRF-safe pre-flight check, optional HMAC signing, and a
   * streaming response size cap. Returns parsed JSON response.
   */
  static async callWebhook(
    implementation: WebhookImplementation,
    input: Record<string, unknown>
  ): Promise<unknown> {
    // SSRF: resolve the URL's hostname and validate every IP before
    // the actual connect. Defeats DNS rebinding (window between our
    // lookup and fetch's lookup is microseconds). Throws
    // SsrfBlockedError on private/reserved IPs unless the emergency
    // TOOLPACK_DISABLE_SSRF_FILTER flag is set.
    await assertUrlSafeToFetch(implementation.url);

    const bodyString = JSON.stringify(input);
    const signedHeaders =
      implementation.signingSecret && !environment.TOOLPACK_DISABLE_SIGNING
        ? signRequest(implementation.signingSecret, bodyString)
        : ({} as Record<string, string>);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(implementation.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(implementation.headers ?? {}),
          ...signedHeaders,
        },
        body: bodyString,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Webhook returned ${response.status}: ${response.statusText}`
        );
      }

      const text = await readResponseTextWithCap(
        response,
        environment.TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES
      );
      try {
        return JSON.parse(text);
      } catch {
        throw new ApiError(
          502,
          ApiCode.TOOLPACK_RUNTIME_INVALID,
          "Toolpack runtime response was not valid JSON"
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build all analytics tools for a station based on its enabled tool packs.
   */
  static async buildAnalyticsTools(
    organizationId: string,
    stationId: string,
    userId: string,
    /**
     * Portal id whose context owns this tools record. Threaded through
     * to tools that need to bind themselves to the calling portal
     * session (`transform_entity_records` is the first such tool;
     * its terminal hook needs to know which portal to notify on job
     * completion). Optional for back-compat with non-portal callers
     * (tests, scratch scripts); production always supplies it.
     */
    portalId?: string
  ): Promise<Record<string, Tool>> {
    const repo = DbService.repository;

    // Load station and validate packs
    const station = await repo.stations.findById(stationId);
    if (!station) throw new Error(`Station not found: ${stationId}`);

    const enabledRows = await repo.stationToolpacks.findByStationId(stationId);
    const builtinSlugs = enabledRows
      .map((r) => r.builtinSlug)
      .filter((s): s is string => s !== null);
    const customPackIds = enabledRows
      .map((r) => r.organizationToolpackId)
      .filter((id): id is string => id !== null);

    if (builtinSlugs.length === 0 && customPackIds.length === 0) {
      throw new Error("Station must have at least one tool pack enabled");
    }

    const toolPacks = builtinSlugs;
    // Station-enabled packs only. System tools are attached below by their
    // `alwaysAvailable` capability (#121), not via pack membership.
    const enabledPacks = new Set<string>(builtinSlugs);

    // Load station data into memory
    const stationData = await AnalyticsService.loadStation(
      stationId,
      organizationId
    );

    const tools: Record<string, Tool> = {};

    // #169 cost gate: track org-hosted (custom) tool names + their declared
    // costHint so the wrap can tag them `costBearer: "organization"` (never
    // charged — the who-pays rule) while surfacing their advisory cost class.
    const customToolNames = new Set<string>();
    const customCostHint: Record<string, CostHint> = {};

    // Capability projections (#121): the enablement + enforcement gates
    // below read declared capability instead of slug/name hardcodes.
    const { SYSTEM_TOOL_CAPABILITIES, ALL_TOOL_CAPABILITIES, isWriteGated } =
      await import("@portalai/core/registries");

    // -------------------------------------------------------------------
    // Always-available system tools (#121: driven by the `alwaysAvailable`
    // capability — replaces the SYSTEM_TOOL_PACKS slug constant).
    // -------------------------------------------------------------------
    // System tools every portal session needs:
    //   - `current_time` — temporal context for resolving relative
    //     expressions ("today", "next week") against the org's timezone.
    //   - `station_context` — on-demand lookup of attached entities,
    //     connector instances, column inventory, and capabilities.
    if (SYSTEM_TOOL_CAPABILITIES.current_time?.alwaysAvailable) {
      tools.current_time = new CurrentTimeTool().build(organizationId);
    }
    if (SYSTEM_TOOL_CAPABILITIES.station_context?.alwaysAvailable) {
      tools.station_context = new StationContextTool().build(
        stationId,
        organizationId
      );
    }

    // -------------------------------------------------------------------
    // Pack: data_query
    // -------------------------------------------------------------------
    if (enabledPacks.has("data_query")) {
      // userId + portalId enable the job-tier escalation (#130 E1b);
      // both are present for production portal callers, absent for
      // non-portal callers (tools then run synchronous-only).
      tools.sql_query = new SqlQueryTool().build(
        stationId,
        organizationId,
        userId,
        portalId
      );
      tools.display_entity_records = new DisplayEntityRecordsTool().build(
        stationId,
        organizationId
      );
      tools.visualize = new VisualizeTool().build(stationId, organizationId);
      tools.visualize_tree = new VisualizeTreeTool().build(
        stationId,
        organizationId
      );

      if (stationData.entityGroups.length > 0) {
        tools.resolve_identity = new ResolveIdentityTool().build(
          organizationId,
          stationData.entityGroups
        );
      }
    }

    // -------------------------------------------------------------------
    // Pack: statistics
    // -------------------------------------------------------------------
    if (enabledPacks.has("statistics")) {
      // Pure compute tools (#114): data arrives as input (a sql_query
      // handle or inline rows), so build() takes no station context.
      // descriptive stats / correlation / outliers / group-by are expressed
      // directly in `sql_query` (Postgres aggregates + window functions) —
      // removed from the reduce tier in #130 E2.
      tools.cluster = new ClusterTool().build();
      tools.hypothesis_test = new HypothesisTestTool().build();
    }

    // -------------------------------------------------------------------
    // Pack: regression
    // -------------------------------------------------------------------
    if (enabledPacks.has("regression")) {
      // Pure compute tools (#114): data arrives as input (a sql_query
      // handle or inline rows), so build() takes no station context.
      // trend / changepoint / decompose are expressed directly in `sql_query`
      // (date_trunc + regr_*, CUSUM window frames, moving-average windows) —
      // removed from the reduce tier in #130 E2.
      tools.regression = new RegressionTool().build();
      tools.logistic_regression = new LogisticRegressionTool().build();
      tools.forecast = new ForecastTool().build();
    }

    // -------------------------------------------------------------------
    // Pack: financial
    // -------------------------------------------------------------------
    if (enabledPacks.has("financial")) {
      // Data-dependent financial tools are pure compute (#114): data
      // arrives as input (a sql_query handle or inline rows), so build()
      // takes no station context. The pure-math tools (npv, irr, …) never
      // read the backend and already take no args.
      // sharpe_ratio / max_drawdown / rolling_returns are expressed directly
      // in `sql_query` (cumulative-product, running-max, and lag() window
      // functions) — removed from the reduce tier in #130 E2.
      tools.technical_indicator = new TechnicalIndicatorTool().build(
        stationId,
        organizationId
      );
      tools.npv = new NpvTool().build();
      tools.irr = new IrrTool().build();
      tools.tvm = new TvmTool().build();
      tools.xnpv = new XnpvTool().build();
      tools.xirr = new XirrTool().build();
      tools.depreciation = new DepreciationTool().build();
      tools.amortize = new AmortizeTool().build();
      tools.var_cvar = new VarCvarTool().build();
      tools.portfolio_metrics = new PortfolioMetricsTool().build();
      tools.bond_math = new BondMathTool().build();
    }

    // -------------------------------------------------------------------
    // Pack: web_search
    // -------------------------------------------------------------------
    if (enabledPacks.has("web_search")) {
      tools.web_search = new WebSearchTool().build();
    }

    // -------------------------------------------------------------------
    // Pack: entity_management
    // -------------------------------------------------------------------
    if (enabledPacks.has("entity_management")) {
      // Write tools are built here; the capability-driven write gate below
      // (#121) removes them when no attached connector instance permits
      // writes — replacing the pack-level `hasWrite` wrapper.
      tools.entity_record_create = new EntityRecordCreateTool().build(
        stationId,
        organizationId,
        userId
      );
      tools.entity_record_update = new EntityRecordUpdateTool().build(
        stationId,
        userId
      );
      tools.entity_record_delete = new EntityRecordDeleteTool().build(
        stationId,
        userId
      );
      tools.connector_entity_create = new ConnectorEntityCreateTool().build(
        stationId,
        userId
      );
      tools.connector_entity_update = new ConnectorEntityUpdateTool().build(
        stationId,
        userId
      );
      tools.connector_entity_delete = new ConnectorEntityDeleteTool().build(
        stationId,
        userId
      );
      tools.field_mapping_create = new FieldMappingCreateTool().build(
        stationId,
        organizationId,
        userId
      );
      tools.field_mapping_update = new FieldMappingUpdateTool().build(
        stationId,
        organizationId,
        userId
      );
      tools.field_mapping_delete = new FieldMappingDeleteTool().build(
        stationId,
        organizationId,
        userId
      );
      // transform_entity_records: only registered when portalId
      // is known (production callers always supply it).
      if (portalId) {
        tools.transform_entity_records =
          new TransformEntityRecordsTool().build(
            portalId,
            stationId,
            organizationId,
            userId
          );
      }
    }

    // -------------------------------------------------------------------
    // Custom toolpacks
    // -------------------------------------------------------------------
    if (customPackIds.length > 0) {
      const customPacks =
        await repo.organizationToolpacks.findManyByIds(customPackIds, {
          organizationId,
        });
      for (const pack of customPacks) {
        for (const tool of pack.tools) {
          if (tool.name in tools) {
            throw new Error(
              `Tool "${tool.name}" is provided by more than one enabled toolpack on this station`
            );
          }
          // #169 who-pays: org-hosted tools are never charged Portal units,
          // but a metered/expensive one may cost the *organization* per call.
          // Surface that to the agent as advisory context on the description
          // (not a server gate — there's no Portal cost to enforce).
          const declaredCost =
            (tool.capability?.costHint as CostHint | undefined) ?? "free";
          const description =
            declaredCost === "metered" || declaredCost === "expensive"
              ? `${tool.description}\n\nNote: this is an organization-provided tool and may be costly to run (your organization is billed for its use); call it only when it directly serves the request.`
              : tool.description;
          tools[tool.name] = new WebhookTool(
            tool.name,
            description,
            tool.parameterSchema as Record<string, unknown>,
            {
              type: "webhook",
              url: pack.endpoints.runtime,
              headers:
                (pack.authHeaders as Record<string, string> | null) ??
                undefined,
              signingSecret: pack.signingSecret,
            },
            stationId,
            // #124: the declared consumption tiers the runtime's data delivery
            // (none → inline; bounded → records-in-body; streaming →
            // pull-on-read). Validated ≤ the widened gate at registration.
            tool.capability?.consumption,
            organizationId,
            // #161: the declared production drives the output write-grant
            // (rows + onLarge:handle → the webhook can stage a result handle),
            // independent of the input consumption tier.
            tool.capability?.production
          ).build();
          customToolNames.add(tool.name);
          customCostHint[tool.name] = declaredCost;
        }
      }
    }

    // Capability-driven write gate (#121): drop any tool that declares a
    // write when no attached connector instance permits writes. Replaces
    // the pack-level `hasWrite` block; per-tool, so it covers any write
    // tool in any pack. Custom webhook tools carry no capability yet
    // (child I) and never write, so they are unaffected.
    const writeGated = Object.keys(tools).filter((name) => {
      const cap = ALL_TOOL_CAPABILITIES[name];
      return cap !== undefined && isWriteGated(cap);
    });
    if (writeGated.length > 0) {
      const stationCaps = await resolveStationCapabilities(stationId);
      const hasWrite = stationCaps.some((sc) => sc.capabilities.write);
      if (!hasWrite) {
        for (const name of writeGated) delete tools[name];
      }
    }

    // #169 cost gate: wrap every tool's execute so each call charges/denies
    // against the org's tier allocation. `free` + org-hosted (custom) tools
    // short-circuit inside the gate; the guard test asserts none is un-wrapped.
    wrapWithCostGate(
      tools as unknown as Record<string, GateableTool>,
      { organizationId, userId },
      (name) => {
        const isCustom = customToolNames.has(name);
        const capability = isCustom ? undefined : ALL_TOOL_CAPABILITIES[name];
        // #184: an application-paid tool with no capability entry falls through
        // to costHint "free" and is never charged. The registry + type system
        // make this unreachable for a declared built-in, so this only fires for
        // a future app tool wired into buildAnalyticsTools without a capability
        // — surface it loudly rather than leak the charge. (Custom tools are
        // org-paid and legitimately have no entry, so they never warn.)
        if (!isCustom && !capability) {
          logger.warn(
            { tool: name },
            "cost gate: application-paid tool has no capability entry; defaulting costHint=free — verify it is registered in ALL_TOOL_CAPABILITIES"
          );
        }
        return {
          costBearer: isCustom ? "organization" : "application",
          costHint: isCustom
            ? customCostHint[name] ?? "free"
            : capability?.costHint ?? "free",
        };
      }
    );

    logger.info(
      {
        stationId,
        toolCount: Object.keys(tools).length,
        packs: toolPacks,
        customPackIds,
      },
      "Analytics tools built"
    );

    return tools;
  }
}
