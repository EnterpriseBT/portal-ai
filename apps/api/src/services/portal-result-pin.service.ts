/**
 * Pin-time materialization (#312, recast by #640): a data pin stores a
 * **recipe** — the query that produces its data and how to draw it — never the
 * rows. Its data executes live as the pin's definer on every view
 * (`PortalVizRefreshService.executePin`), so a pin can't hold rows its definer
 * no longer sees, and it empties when they lose access.
 *
 * The pin route validates the source block against its per-type contract
 * (`PINNED_CONTENT_SCHEMAS`). A data block must carry a re-executable query
 * (its own `pipeline`, its `sql`, or the `sql` its query handle retains); one
 * without is refused with `PORTAL_RESULT_NOT_REEXECUTABLE`, since there would
 * be nothing to run. Narrative text stays self-contained.
 */
import { z } from "zod";
import {
  PINNED_CONTENT_SCHEMAS,
  VizPipelineSchema,
  type VizPipeline,
} from "@portalai/core/contracts";
import type { PortalResultType } from "@portalai/core/models";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { PortalSqlHandleService } from "./portal-sql-handle.service.js";

/** DI seam (test): the handle meta reader. */
export interface MaterializeDeps {
  getMeta?: typeof PortalSqlHandleService.getMeta;
}

export interface MaterializeScope {
  stationId: string;
  organizationId: string;
}

export interface MaterializedPin {
  content: Record<string, unknown> | string;
}

/** The keys each data kind keeps: the recipe, never the rows. */
const RECIPE_KEYS: Partial<Record<PortalResultType, readonly string[]>> = {
  "data-table": [],
  d3: ["program", "title", "params"],
  geo: ["spec", "title", "program"],
};

function contentMismatch(type: PortalResultType): ApiError {
  return new ApiError(
    400,
    ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    `Block content does not match the "${type}" pinned-content contract`
  );
}

function notReexecutable(): ApiError {
  return new ApiError(
    422,
    ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE,
    "This result has no query to re-run, so it can't be pinned — re-run the prompt and pin the new result."
  );
}

function pipelineFromSql(
  sql: unknown,
  scope: MaterializeScope
): VizPipeline | undefined {
  return typeof sql === "string" && sql.length > 0
    ? { sql, stationId: scope.stationId, organizationId: scope.organizationId }
    : undefined;
}

export class PortalResultPinService {
  /**
   * Validate `blockContent` against the per-type contract and reduce it to the
   * pin's recipe. The pipeline is the block's own, else its `sql`, else the
   * `sql` retained by its query handle's meta (the persisted display block
   * omits it). A handle that expired or retains no `sql` leaves no query: the
   * pin is refused.
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

    if (type === "text") {
      const parsed = schema.safeParse(blockContent);
      if (!parsed.success) throw contentMismatch(type);
      return { content: parsed.data as string };
    }

    const source = (blockContent ?? {}) as Record<string, unknown>;
    const pipeline = await this.derivePipeline(source, scope, deps);
    if (!pipeline) throw notReexecutable();

    const recipe: Record<string, unknown> = { pipeline };
    for (const key of RECIPE_KEYS[type] ?? []) {
      if (source[key] !== undefined) recipe[key] = source[key];
    }
    if (type === "data-table") {
      recipe.columns = Array.isArray(source.columns)
        ? source.columns
        : Array.isArray(source.schema)
          ? (source.schema as Array<{ name?: unknown }>)
              .map((c) => c?.name)
              .filter((n): n is string => typeof n === "string")
          : [];
    }
    // #371: a map whose source was a handle (larger than an inline result)
    // renders through the pin's tile endpoint from the start.
    if (type === "geo" && typeof source.queryHandle === "string") {
      recipe.tiled = true;
    }

    const parsed = schema.safeParse(recipe);
    if (!parsed.success) throw contentMismatch(type);
    return { content: parsed.data as Record<string, unknown> };
  }

  private static async derivePipeline(
    source: Record<string, unknown>,
    scope: MaterializeScope,
    deps: MaterializeDeps
  ): Promise<VizPipeline | undefined> {
    const own = VizPipelineSchema.safeParse(source.pipeline);
    if (own.success) return own.data;
    const fromSql = pipelineFromSql(source.sql, scope);
    if (fromSql) return fromSql;
    if (typeof source.queryHandle !== "string") return undefined;
    const getMeta =
      deps.getMeta ??
      PortalSqlHandleService.getMeta.bind(PortalSqlHandleService);
    try {
      return pipelineFromSql((await getMeta(source.queryHandle)).sql, scope);
    } catch (err) {
      // An expired handle leaves no query to keep.
      if (err instanceof ApiError && err.code === ApiCode.READ_HANDLE_EXPIRED) {
        return undefined;
      }
      throw err;
    }
  }
}
