/**
 * Widget refresh (#270): re-execute a persisted `d3` widget's durable pipeline
 * for live data, long after its ephemeral Redis handle has expired.
 *
 * Reference-based by design (discovery D3): the caller names the widget by
 * `{ messageId, blockIndex }` and the server loads the *persisted* SQL from the
 * block — the client never supplies SQL, keeping the infiltration surface
 * minimal. Scope is gated on the message's own `organizationId` (the
 * authoritative owned row), and the SQL re-runs read-only under that org via
 * the same `resolveSqlDelivery` funnel `visualize_d3` used at mint time.
 */

import type { WidgetRefreshResponse } from "@portalai/core/contracts";
import { VizPipelineSchema, type VizPipeline } from "@portalai/core/contracts";
import { PIN_SNAPSHOT_ROW_CAP } from "@portalai/core/constants";
import { DateFactory } from "@portalai/core/utils";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { PortalSqlHandleService } from "./portal-sql-handle.service.js";
import { resolveSqlDelivery as defaultResolveSqlDelivery } from "../tools/result-sink.js";
import {
  geometryColumnsFromSpec,
  geoInlineRows,
} from "../tools/geo-delivery.util.js";
import { AnalyticsService } from "./analytics.service.js";
import { portalMessagesRepo } from "../db/repositories/portal-messages.repository.js";
import { portalResultsRepo } from "../db/repositories/portal-results.repository.js";
import type {
  PortalMessageSelect,
  PortalResultSelect,
  PortalResultInsert,
} from "../db/schema/zod.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "portal-viz-refresh" });

/** DI seam (test): the message loader + the SQL delivery resolver. `sqlQuery`
 *  is the geometry→GeoJSON display query a `geo` widget needs on the inline
 *  path (#314). */
export interface VizRefreshDeps {
  findMessageById?: (id: string) => Promise<PortalMessageSelect | undefined>;
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
  sqlQuery?: typeof AnalyticsService.sqlQuery;
}

/** DI seam (test) for the pin addresser (#312). */
export interface PinRefreshDeps {
  findPortalResultById?: (
    id: string
  ) => Promise<PortalResultSelect | undefined>;
  updatePortalResult?: (
    id: string,
    patch: Partial<PortalResultInsert>
  ) => Promise<PortalResultSelect | undefined>;
  getSnapshot?: typeof PortalSqlHandleService.getSnapshot;
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
  sqlQuery?: typeof AnalyticsService.sqlQuery;
}

export interface VizRefreshParams {
  messageId: string;
  blockIndex: number;
  /** The caller's current org (from `req.application.metadata`). */
  organizationId: string;
}

/**
 * Block types backed by a durable pipeline and therefore refreshable. A block
 * outside this set is 404 — it isn't a widget, as distinct from a widget that
 * has no pipeline (422).
 */
const REFRESHABLE_BLOCK_TYPES = new Set(["d3", "geo", "data-table"]);

function notFound(): ApiError {
  return new ApiError(
    404,
    ApiCode.VIZ_WIDGET_NOT_FOUND,
    "No refreshable visualization widget for this reference."
  );
}

export class PortalVizRefreshService {
  static async refresh(
    params: VizRefreshParams,
    deps: VizRefreshDeps = {}
  ): Promise<WidgetRefreshResponse> {
    const findMessageById =
      deps.findMessageById ?? ((id: string) => portalMessagesRepo.findById(id));
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;
    const sqlQuery =
      deps.sqlQuery ?? AnalyticsService.sqlQuery.bind(AnalyticsService);

    const message = await findMessageById(params.messageId);
    if (!message) throw notFound();

    // Scope gate: the message's own org is the authoritative owner. Cross-org
    // callers get the same 404 as a missing widget — no existence leak.
    if (message.organizationId !== params.organizationId) throw notFound();

    const blocks = (message.blocks ?? []) as Array<Record<string, unknown>>;
    const block = blocks[params.blockIndex];
    // Every durable widget kind refreshes through the same pipeline path (#314
    // added `geo`, #349 `data-table`); a block outside the set has no pipeline.
    //
    // Note the status consequence for tables: a pre-#349 data-table block used
    // to fall out here as 404 and now reaches the pipeline check below as 422
    // — the honest answer, and the one `useWidgetRefresh` renders as
    // `notRefreshable`.
    if (!block || !REFRESHABLE_BLOCK_TYPES.has(block.type as string))
      throw notFound();

    // Persisted display blocks are wrapped `{ type, content }` by
    // `resolveDisplayBlock` — the d3 tool result (program, pipeline, rows /
    // envelope) rides under `content`, which is exactly what the web renderer
    // reads. Read the pipeline from there, not the wrapper's top level.
    const inner = (block.content ?? block) as Record<string, unknown>;
    const parsed = VizPipelineSchema.safeParse(inner.pipeline);
    if (!parsed.success) {
      throw new ApiError(
        422,
        ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
        "This visualization has no durable pipeline and can't be refreshed."
      );
    }
    const pipeline = parsed.data;

    // A geo widget's inline rows must carry GeoJSON, not raw WKB — the same
    // conversion the tool applies at mint (#314). Non-geo (d3) blocks have no
    // geometry columns, so this is a no-op for them.
    const geometryColumns = geometryColumnsFromSpec(inner.spec);

    return this.executePipeline(
      pipeline,
      params.organizationId,
      resolveSqlDelivery,
      geometryColumns,
      sqlQuery
    );
  }

  /**
   * Pin addresser (#312): re-execute a pinned result's stored pipeline.
   * Scope gates on the row's own `organizationId` (cross-org → the same 404
   * as a missing row — no existence leak), then **persists back** the fresh
   * snapshot (rows ≤ `PIN_SNAPSHOT_ROW_CAP`, `rowCount`, `truncated`,
   * `snapshotUpdatedAt`). Persist-back failure is non-fatal: the live
   * delivery already succeeded and the stale stored snapshot self-heals on
   * the next refresh.
   */
  static async refreshPinnedResult(
    params: { portalResultId: string; organizationId: string },
    deps: PinRefreshDeps = {}
  ): Promise<WidgetRefreshResponse> {
    const findPortalResultById =
      deps.findPortalResultById ??
      ((id: string) => portalResultsRepo.findById(id));
    const updatePortalResult =
      deps.updatePortalResult ??
      ((id: string, patch: Partial<PortalResultInsert>) =>
        portalResultsRepo.update(id, patch));
    const getSnapshot =
      deps.getSnapshot ??
      PortalSqlHandleService.getSnapshot.bind(PortalSqlHandleService);
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;
    const sqlQuery =
      deps.sqlQuery ?? AnalyticsService.sqlQuery.bind(AnalyticsService);

    const row = await findPortalResultById(params.portalResultId);
    if (!row || row.organizationId !== params.organizationId) {
      throw new ApiError(
        404,
        ApiCode.PORTAL_RESULT_NOT_FOUND,
        "Pinned result not found"
      );
    }

    const content = (row.content ?? {}) as Record<string, unknown>;
    const parsed = VizPipelineSchema.safeParse(content.pipeline);
    if (!parsed.success) {
      throw new ApiError(
        422,
        ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
        "This pinned result has no durable pipeline and can't be refreshed."
      );
    }

    const delivery = await this.executePipeline(
      parsed.data,
      params.organizationId,
      resolveSqlDelivery,
      geometryColumnsFromSpec(content.spec),
      sqlQuery
    );

    try {
      let rows: Array<Record<string, unknown>>;
      let total: number;
      if (delivery.kind === "inline") {
        rows = delivery.rows;
        total = rows.length;
      } else {
        const snap = await getSnapshot(delivery.queryHandle, {
          offset: 0,
          limit: PIN_SNAPSHOT_ROW_CAP,
        });
        rows = snap.rows;
        total = delivery.rowCount;
      }
      await updatePortalResult(row.id, {
        content: {
          ...content,
          rows,
          rowCount: total,
          // #340: `total` here is the true snapshot total → exact matched count.
          matchedCount: total,
          matchedCountExact: true,
          truncated: total > rows.length,
        },
        snapshotUpdatedAt: new DateFactory("UTC").now().getTime(),
      });
    } catch (err) {
      logger.warn(
        { err, portalResultId: row.id },
        "pin refresh persist-back failed; stored snapshot left stale"
      );
    }

    return delivery;
  }

  /**
   * Shared core: execute a durable pipeline read-only under the (verified)
   * caller org — the same funnel as the original mint — and map the delivery
   * to the refresh-response union.
   */
  private static async executePipeline(
    pipeline: VizPipeline,
    organizationId: string,
    resolveSqlDelivery: typeof defaultResolveSqlDelivery,
    geometryColumns: string[] = [],
    sqlQuery: typeof AnalyticsService.sqlQuery = AnalyticsService.sqlQuery.bind(
      AnalyticsService
    )
  ): Promise<WidgetRefreshResponse> {
    const delivery = await resolveSqlDelivery(
      { sql: pipeline.sql },
      { stationId: pipeline.stationId, organizationId }
    );

    // A large delivery rides its handle — the map widget re-tiles it through
    // #316 (no inline rows to re-project).
    if (delivery.kind === "handle") {
      return { kind: "handle", ...delivery.envelope };
    }
    const result = delivery.result as {
      rows?: Array<Record<string, unknown>>;
      sample?: Array<Record<string, unknown>>;
    };
    // Inline: a geo widget (geometryColumns non-empty) needs its geometry
    // re-projected to GeoJSON, exactly as the tool does at mint. A d3 widget
    // passes []-columns and the rows ride through untouched.
    const rows = await geoInlineRows(
      pipeline.sql,
      geometryColumns,
      result.rows ?? result.sample ?? [],
      { stationId: pipeline.stationId, organizationId },
      { sqlQuery }
    );
    return { kind: "inline", rows };
  }
}
