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

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { STALE_REFERENCE } from "./portal-sql-validation.util.js";
import { resolveSqlDelivery as defaultResolveSqlDelivery } from "../tools/result-sink.js";
import {
  geometryColumnsFromSpec,
  geoInlineRows,
} from "../tools/geo-delivery.util.js";
import { AnalyticsService } from "./analytics.service.js";
import { PortalSqlService } from "./portal-sql.service.js";
import { PortalSqlHandleService } from "./portal-sql-handle.service.js";
import type { TransformDescriptor } from "./transform-fold.js";
import { portalMessagesRepo } from "../db/repositories/portal-messages.repository.js";
import type {
  PortalMessageSelect,
  PortalResultSelect,
} from "../db/schema/zod.js";
import {
  DefinerAccessLostError,
  PinDefinerService,
} from "./pin-definer.service.js";

/** DI seam (test): the message loader + the SQL delivery resolver. `sqlQuery`
 *  is the geometry→GeoJSON display query a `geo` widget needs on the inline
 *  path (#314). */
export interface VizRefreshDeps {
  findMessageById?: (id: string) => Promise<PortalMessageSelect | undefined>;
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
  sqlQuery?: typeof AnalyticsService.sqlQuery;
  /** #1038: a transform pipeline stages its source and folds it. */
  produce?: typeof PortalSqlHandleService.produce;
  produceFromTransform?: typeof PortalSqlHandleService.produceFromTransform;
}

/** The handle producers a transform pipeline re-runs through (#1038). */
interface TransformHandles {
  produce: typeof PortalSqlHandleService.produce;
  produceFromTransform: typeof PortalSqlHandleService.produceFromTransform;
}

/** DI seam (test) for the live pin read (#640). */
export interface PinDataDeps {
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
  sqlQuery?: typeof AnalyticsService.sqlQuery;
  assertDefinerActive?: typeof PinDefinerService.assertDefinerActive;
  explainSqlQuery?: typeof PortalSqlService.explainSqlQuery;
}

/** Who is reading a pin (#640) — it decides how much a refusal explains. */
export interface PinViewer {
  userId: string;
  /** May manage the pin (`resource.write`): told why its data is gone. */
  canWrite: boolean;
}

export interface VizRefreshParams {
  messageId: string;
  blockIndex: number;
  /** The caller's current org (from `req.application.metadata`). */
  organizationId: string;
  /** #599: the requesting user — the refresh re-executes per-user view-scoped. */
  userId: string;
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
    const handles: TransformHandles = {
      produce:
        deps.produce ??
        PortalSqlHandleService.produce.bind(PortalSqlHandleService),
      produceFromTransform:
        deps.produceFromTransform ??
        PortalSqlHandleService.produceFromTransform.bind(
          PortalSqlHandleService
        ),
    };

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
      params.userId,
      resolveSqlDelivery,
      geometryColumns,
      sqlQuery,
      undefined,
      handles
    );
  }

  /**
   * #640: a pin's data, live, as its **definer** sees it now. Nothing is
   * persisted: the pin is a recipe, and the rows exist only in this response
   * (or in a pin-owned handle, readable by the pin's readers).
   *
   * The caller has already authorized the viewer's read on `row`. Here the
   * definer must still be an active member of the pin's org, and the query
   * must still match the views they can read; either failing empties the pin
   * (a reason for a viewer who manages it, a neutral message otherwise). A
   * definer whose views simply match no rows gets an ordinary empty result.
   */
  static async executePin(
    row: PortalResultSelect,
    viewer: PinViewer,
    deps: PinDataDeps = {}
  ): Promise<WidgetRefreshResponse> {
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;
    const sqlQuery =
      deps.sqlQuery ?? AnalyticsService.sqlQuery.bind(AnalyticsService);
    const assertDefinerActive =
      deps.assertDefinerActive ?? PinDefinerService.assertDefinerActive;

    const content = (row.content ?? {}) as Record<string, unknown>;
    const parsed = VizPipelineSchema.safeParse(content.pipeline);
    if (!parsed.success) {
      throw new ApiError(
        422,
        ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE,
        "This pin can't refresh — re-pin it from a new result."
      );
    }

    const unavailable = () =>
      PinDefinerService.unavailableError({
        canWrite: viewer.canWrite,
        isDefiner: row.definerPrincipalId === viewer.userId,
      });

    try {
      const { userId: definerId } = await assertDefinerActive(row);
      // A tiled map draws only from its tile endpoint, which runs the query
      // per tile. Planning it as the definer refuses exactly what running it
      // would (a lost view or column), without the full scan or a handle no
      // one reads.
      if (row.type === "geo" && content.tiled === true) {
        const explain =
          deps.explainSqlQuery ??
          PortalSqlService.explainSqlQuery.bind(PortalSqlService);
        await explain({
          sql: parsed.data.sql,
          stationId: parsed.data.stationId,
          organizationId: row.organizationId,
          userId: definerId,
        });
        return { kind: "tiles" };
      }
      return await this.runPipeline(
        parsed.data,
        row.organizationId,
        definerId,
        resolveSqlDelivery,
        geometryColumnsFromSpec(content.spec),
        sqlQuery,
        row.id
      );
    } catch (err) {
      if (err instanceof DefinerAccessLostError) throw unavailable();
      // The query names a view or column the definer no longer exposes.
      if (
        err instanceof ApiError &&
        err.code === ApiCode.PORTAL_SQL_FORBIDDEN &&
        err.details?.reason === STALE_REFERENCE
      ) {
        throw unavailable();
      }
      throw err;
    }
  }

  /**
   * #727: {@link runPipeline}, with a stored query that no longer matches the
   * caller's views (it names a view or column they don't expose: an "unknown
   * entity" / "unknown column" refusal) answered as a widget that can't be
   * refreshed until its prompt is re-run, not a 500.
   */
  private static async executePipeline(
    ...args: Parameters<typeof PortalVizRefreshService.runPipeline>
  ): Promise<WidgetRefreshResponse> {
    try {
      return await this.runPipeline(...args);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === ApiCode.PORTAL_SQL_FORBIDDEN &&
        err.details?.reason === STALE_REFERENCE
      ) {
        // #1038: a revoked grant, a detached view and a dropped column all
        // read alike here (the refusal never confirms a hidden view). The
        // answer is "unavailable", never a cue to show a stored copy.
        throw new ApiError(
          422,
          ApiCode.VIZ_WIDGET_DATA_UNAVAILABLE,
          "This result is no longer available to you."
        );
      }
      throw err;
    }
  }

  /**
   * Shared core: execute a durable pipeline read-only under the (verified)
   * caller org — the same funnel as the original mint — and map the delivery
   * to the refresh-response union.
   */
  private static async runPipeline(
    pipeline: VizPipeline,
    organizationId: string,
    userId: string,
    resolveSqlDelivery: typeof defaultResolveSqlDelivery,
    geometryColumns: string[] = [],
    sqlQuery: typeof AnalyticsService.sqlQuery = AnalyticsService.sqlQuery.bind(
      AnalyticsService
    ),
    /** #640: the pin being delivered; a staged handle then belongs to it. */
    portalResultId?: string,
    handles?: TransformHandles
  ): Promise<WidgetRefreshResponse> {
    // #1038: a transform pipeline (technical_indicator) re-runs its source
    // query as the caller, then folds it into a fresh transform handle. A pin
    // can't carry one: a transform handle can't be pin-owned, so its readers
    // couldn't page it.
    if (pipeline.transform != null) {
      if (portalResultId != null || handles == null) {
        throw new ApiError(
          422,
          ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE,
          "This result can't be re-run here."
        );
      }
      const scope = { stationId: pipeline.stationId, organizationId, userId };
      const source = await handles.produce({ sql: pipeline.sql, ...scope });
      const { envelope } = await handles.produceFromTransform({
        transform: {
          ...(pipeline.transform as Omit<TransformDescriptor, "sourceHandle">),
          sourceHandle: source.envelope.queryHandle,
        },
        ...scope,
      });
      return { kind: "handle", ...envelope };
    }
    const delivery = await resolveSqlDelivery(
      { sql: pipeline.sql },
      {
        stationId: pipeline.stationId,
        organizationId,
        userId,
        ...(portalResultId ? { portalResultId } : {}),
      }
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
      { stationId: pipeline.stationId, organizationId, userId },
      { sqlQuery }
    );
    return { kind: "inline", rows };
  }
}
