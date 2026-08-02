/**
 * Pin-time materialization (#312): a pin persists a **self-contained**
 * snapshot, never a bare handle envelope — the 24h Redis handle TTL must not
 * outlive a pin. The pin route validates the source block against its
 * per-type contract (`PINNED_CONTENT_SCHEMAS`), hydrates handle-backed
 * content up to `PIN_SNAPSHOT_ROW_CAP` rows, and derives the durable
 * `pipeline` that makes the pin refreshable (#312 slice 3).
 */
import { z } from "zod";
import {
  PINNED_CONTENT_SCHEMAS,
  D3PipelineSchema,
  type D3Pipeline,
} from "@portalai/core/contracts";
import type { PortalResultType } from "@portalai/core/models";
import { PIN_SNAPSHOT_ROW_CAP } from "@portalai/core/constants";
import { DateFactory } from "@portalai/core/utils";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { PortalSqlHandleService } from "./portal-sql-handle.service.js";
import { resolveSqlDelivery as defaultResolveSqlDelivery } from "../tools/result-sink.js";

/** DI seam (test): the handle readers + the SQL delivery resolver. */
export interface MaterializeDeps {
  getSnapshot?: typeof PortalSqlHandleService.getSnapshot;
  getMeta?: typeof PortalSqlHandleService.getMeta;
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
}

export interface MaterializeScope {
  stationId: string;
  organizationId: string;
}

export interface MaterializedPin {
  content: Record<string, unknown> | string;
  /** Epoch ms of this snapshot — written to `portal_results.snapshot_updated_at`. */
  snapshotUpdatedAt: number;
}

function contentMismatch(type: PortalResultType): ApiError {
  return new ApiError(
    400,
    ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    `Block content does not match the "${type}" pinned-content contract`
  );
}

/**
 * The durable pipeline for a block: its own `pipeline` when present (d3),
 * else derived from the handle envelope's retained `sql` (data-table).
 * `sql: null` (externally-supplied rows) yields no pipeline — the pin is a
 * static snapshot.
 */
function derivePipeline(
  source: Record<string, unknown>,
  scope: MaterializeScope
): D3Pipeline | undefined {
  const own = D3PipelineSchema.safeParse(source.pipeline);
  if (own.success) return own.data;
  if (typeof source.sql === "string" && source.sql.length > 0) {
    return {
      sql: source.sql,
      stationId: scope.stationId,
      organizationId: scope.organizationId,
    };
  }
  return undefined;
}

function assemble(
  source: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
  total: number,
  pipeline: D3Pipeline | undefined
): Record<string, unknown> {
  const schemaNames = Array.isArray(source.schema)
    ? (source.schema as Array<{ name?: unknown }>)
        .map((c) => c?.name)
        .filter((n): n is string => typeof n === "string")
    : [];
  const columns = Array.isArray(source.columns) ? source.columns : schemaNames;
  return {
    ...source,
    columns,
    rows,
    rowCount: total,
    truncated: total > rows.length,
    ...(pipeline ? { pipeline } : {}),
  };
}

export class PortalResultPinService {
  /**
   * Validate `blockContent` against the per-type contract and resolve it to
   * a self-contained snapshot (≤ `PIN_SNAPSHOT_ROW_CAP` rows). Handle-backed
   * content is hydrated from the live handle; an expired handle is
   * re-executed through its pipeline, or rejected with
   * `PORTAL_RESULT_CONTENT_EXPIRED` when no pipeline exists.
   */
  static async materialize(
    type: PortalResultType,
    blockContent: unknown,
    scope: MaterializeScope,
    deps: MaterializeDeps = {}
  ): Promise<MaterializedPin> {
    const schema: z.ZodType | undefined = PINNED_CONTENT_SCHEMAS[type];
    if (!schema) {
      throw new ApiError(
        400,
        ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
        `Block type "${type}" has no pinned-content contract`
      );
    }
    const snapshotUpdatedAt = new DateFactory("UTC").now().getTime();

    if (type === "text") {
      const parsed = schema.safeParse(blockContent);
      if (!parsed.success) throw contentMismatch(type);
      return { content: parsed.data as string, snapshotUpdatedAt };
    }

    const source = (blockContent ?? {}) as Record<string, unknown>;
    const candidate =
      typeof source.queryHandle === "string"
        ? await this.materializeFromHandle(source, scope, deps)
        : source;

    const parsed = schema.safeParse(candidate);
    if (!parsed.success) throw contentMismatch(type);
    return {
      content: parsed.data as Record<string, unknown>,
      snapshotUpdatedAt,
    };
  }

  private static async materializeFromHandle(
    source: Record<string, unknown>,
    scope: MaterializeScope,
    deps: MaterializeDeps
  ): Promise<Record<string, unknown>> {
    const getSnapshot =
      deps.getSnapshot ??
      PortalSqlHandleService.getSnapshot.bind(PortalSqlHandleService);
    const getMeta =
      deps.getMeta ??
      PortalSqlHandleService.getMeta.bind(PortalSqlHandleService);
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;
    let pipeline = derivePipeline(source, scope);

    try {
      const snap = await getSnapshot(source.queryHandle as string, {
        offset: 0,
        limit: PIN_SNAPSHOT_ROW_CAP,
      });
      if (!pipeline) {
        // The persisted display block omits the envelope's retained `sql`
        // (it carries only what the client renderer needs) — the
        // server-side handle meta is the authoritative source (#312 smoke
        // find). A failed meta read degrades to a static snapshot.
        try {
          const meta = await getMeta(source.queryHandle as string);
          if (typeof meta.sql === "string" && meta.sql.length > 0) {
            pipeline = {
              sql: meta.sql,
              stationId: scope.stationId,
              organizationId: scope.organizationId,
            };
          }
        } catch {
          // expired between the snapshot and meta reads — static pin
        }
      }
      return assemble(source, snap.rows, snap.total, pipeline);
    } catch (err) {
      const expired =
        err instanceof ApiError && err.code === ApiCode.READ_HANDLE_EXPIRED;
      if (!expired) throw err;
      if (!pipeline) {
        throw new ApiError(
          422,
          ApiCode.PORTAL_RESULT_CONTENT_EXPIRED,
          "This result's data has expired and it has no re-executable query — re-run the prompt and pin the fresh result"
        );
      }
      // Materialize by re-execution — the same funnel the refresh path uses.
      const delivery = await resolveSqlDelivery(
        { sql: pipeline.sql },
        { stationId: scope.stationId, organizationId: scope.organizationId }
      );
      if (delivery.kind === "inline") {
        const result = delivery.result as {
          rows?: Array<Record<string, unknown>>;
          sample?: Array<Record<string, unknown>>;
        };
        const rows = result.rows ?? result.sample ?? [];
        return assemble(source, rows, rows.length, pipeline);
      }
      const snap = await getSnapshot(delivery.envelope.queryHandle, {
        offset: 0,
        limit: PIN_SNAPSHOT_ROW_CAP,
      });
      return assemble(source, snap.rows, delivery.envelope.rowCount, pipeline);
    }
  }
}
