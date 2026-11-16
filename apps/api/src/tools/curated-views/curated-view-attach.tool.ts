import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { StationAttachmentService } from "../../services/station-attachment.service.js";
import { PortalSqlService } from "../../services/portal-sql.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT } from "../rbac/rbac-tool.util.js";
import { runViewTool } from "./curated-view-tool.util.js";
import {
  viewAttachmentAudit,
  type ViewToolSession,
} from "./station-attachment-tool.util.js";

/** A batch is capped so one call can't fan out unboundedly. */
export const MAX_ATTACH_BATCH = 25;

const InputSchema = z
  .object({
    curatedViewIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_ATTACH_BATCH)
      .describe(
        "Ids of the views to attach (1-25), from curated_view_list or curated_view_create"
      ),
    stationId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The station to attach to, from station_list. Omit it to attach to this session's station"
      ),
  })
  .strict();

/** What a view attached to the session's station reads as in sql_query now. */
type AttachedViewReport =
  | {
      id: string;
      key: string;
      label: string;
      queryable: true;
      /** As `station_context` reports them: `wideColumnName` is what SQL
       *  reads; `key` is the column's field key. */
      columns: { key: string; wideColumnName: string; type: string }[];
    }
  | {
      id: string;
      key: string;
      label: string;
      queryable: false;
      /** Another view attached here already uses this key, so sql_query
       *  skips this one. */
      reason: "KEY_CONFLICT";
    };

/**
 * #1036: attach views to a station — this session's by default — through
 * `StationAttachmentService.attachViews`, the attach route's own path: write
 * on the station, read on every view, all or nothing.
 *
 * Attaching to the session's own station also drops this request's cached
 * view set, so a `sql_query` later in the same turn reads the new view, and
 * reports each view's SQL name and columns (the system prompt's roster only
 * lists it from the next turn).
 */
export class CuratedViewAttachTool extends Tool<typeof InputSchema> {
  slug = "curated_view_attach";
  name = "curated_view_attach";
  description =
    "Attaches curated views to a station so portal sessions on it can query them. It attaches to this session's station unless you name another with stationId (from station_list). Attached here, a view can be queried with sql_query in the same turn: the view's key is the table and each column's wideColumnName is the column, as the result returns them. All the views must be ones the user can read, and the user must be allowed to edit the station; otherwise nothing is attached. A view already attached is reported, not an error.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext, session: ViewToolSession) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_ATTACH_FAILED, async () => {
          const { curatedViewIds, stationId: target } = this.validate(input);
          const stationId = target ?? session.stationId;
          const result = await StationAttachmentService.attachViews(
            ctx,
            { stationId, curatedViewIds },
            viewAttachmentAudit(ctx, AGENT_AUDIT)
          );
          const isSessionStation = stationId === session.stationId;
          if (!isSessionStation) {
            return { success: true, isSessionStation, ...result };
          }
          if (result.added.length > 0) {
            PortalSqlService.forgetSessionViews(
              stationId,
              ctx.organizationId,
              ctx.userId
            );
          }
          return {
            success: true,
            isSessionStation,
            ...result,
            views: await reportSessionViews(ctx, stationId, curatedViewIds),
          };
        }),
    });
  }
}

/**
 * The requested views as the session's `sql_query` now sees them: queryable
 * with their columns, or skipped because another attached view holds the key.
 */
async function reportSessionViews(
  ctx: PermissionContext,
  stationId: string,
  requestedIds: string[]
): Promise<AttachedViewReport[]> {
  const { set, views } = await PortalSqlService.resolveGrantedViewColumns(
    stationId,
    ctx.organizationId,
    ctx.userId
  );
  const queryable = new Map(views.map((v) => [v.view.id, v.columns]));
  const attached =
    (
      await StationAttachmentService.listViewsForStations(
        set,
        ctx.organizationId,
        [stationId]
      )
    ).get(stationId) ?? [];
  const requested = new Set(requestedIds);
  const reports: AttachedViewReport[] = [];
  for (const entry of attached) {
    if (!entry.canRead || !requested.has(entry.id)) continue;
    const columns = queryable.get(entry.id);
    const { id, key, label } = entry;
    reports.push(
      columns
        ? {
            id,
            key,
            label,
            queryable: true,
            columns: columns.map((c) => ({
              key: c.normalizedKey,
              wideColumnName: c.columnName,
              type: c.pgType,
            })),
          }
        : { id, key, label, queryable: false, reason: "KEY_CONFLICT" }
    );
  }
  return reports;
}
