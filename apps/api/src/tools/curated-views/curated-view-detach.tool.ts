import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { StationAttachmentService } from "../../services/station-attachment.service.js";
import { PortalSqlService } from "../../services/portal-sql.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT } from "../rbac/rbac-tool.util.js";
import { runViewTool } from "./curated-view-tool.util.js";
import { MAX_ATTACH_BATCH } from "./curated-view-attach.tool.js";
import {
  viewAttachmentAudit,
  type ViewToolSession,
} from "./station-attachment-tool.util.js";

const InputSchema = z
  .object({
    curatedViewIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_ATTACH_BATCH)
      .describe("Ids of the views to detach (1-25)"),
    stationId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The station to detach from, from station_list. Omit it for this session's station"
      ),
  })
  .strict();

/**
 * #1036: detach views from a station — this session's by default — through
 * `StationAttachmentService.detachViews`: write on the station is enough
 * (#674: detaching edits the station). Detaching from the session's own
 * station drops this request's cached view set, so the view is gone from
 * `sql_query` in the same turn.
 */
export class CuratedViewDetachTool extends Tool<typeof InputSchema> {
  slug = "curated_view_detach";
  name = "curated_view_detach";
  description =
    "Detaches curated views from a station, this session's unless you name another with stationId (from station_list). The views themselves aren't changed or deleted; sessions on that station just stop seeing them. The user must be allowed to edit the station. A view that isn't attached is reported, not an error.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext, session: ViewToolSession) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_DETACH_FAILED, async () => {
          const { curatedViewIds, stationId: target } = this.validate(input);
          const stationId = target ?? session.stationId;
          const result = await StationAttachmentService.detachViews(
            ctx,
            { stationId, curatedViewIds },
            viewAttachmentAudit(ctx, AGENT_AUDIT, session)
          );
          const isSessionStation = stationId === session.stationId;
          if (isSessionStation && result.removed.length > 0) {
            PortalSqlService.forgetSessionViews(
              stationId,
              ctx.organizationId,
              ctx.userId
            );
          }
          return { success: true, isSessionStation, ...result };
        }),
    });
  }
}
