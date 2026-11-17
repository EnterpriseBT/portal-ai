import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { StationQueryService } from "../../services/station-query.service.js";
import { StationAttachmentService } from "../../services/station-attachment.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runViewTool } from "./curated-view-tool.util.js";
import type { ViewToolSession } from "./station-attachment-tool.util.js";

const InputSchema = z
  .object({
    search: z
      .string()
      .max(120)
      .optional()
      .describe("Match stations whose name contains this text"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(25)
      .describe("Page size, 1-100 (default 25)"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("Rows to skip (default 0)"),
  })
  .strict();

/**
 * #1036: the stations the user can see, so the agent can resolve "attach it
 * to the Sales station" to an id. Reads through `StationQueryService` — the
 * same listing as `GET /api/stations` — and each station's attached views in
 * one batched read. A view the user can't read is reported only as
 * `{ unreadable: true }`: no id, key or label reaches the agent.
 */
export class StationListTool extends Tool<typeof InputSchema> {
  slug = "station_list";
  name = "station_list";
  description =
    "Lists the stations the user can see, sorted by name: each with its id, name, description, whether it's this session's station, what the user may do to it (write means they can attach views to it), its tool packs (check for data_query before attaching a view the user wants to query there), and the views attached to it. Use it to find a station's id for curated_view_attach or curated_view_detach.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext, session: ViewToolSession) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.STATION_LIST_FAILED, async () => {
          const { search, limit, offset } = this.validate(input);
          const { set, stations, total } =
            await StationQueryService.listForCaller(ctx, {
              search,
              limit,
              offset,
              sortBy: "name",
              sortOrder: "asc",
            });
          const viewsByStation =
            await StationAttachmentService.listViewsForStations(
              set,
              ctx.organizationId,
              stations.map((s) => s.id)
            );
          return {
            stations: stations.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description ?? null,
              isSessionStation: s.id === session.stationId,
              capabilities: s.capabilities,
              toolpacks: s.enabledToolpacks,
              views: (viewsByStation.get(s.id) ?? []).map((v) =>
                v.canRead
                  ? { id: v.id, key: v.key, label: v.label }
                  : { unreadable: true as const }
              ),
            })),
            total,
            limit,
            offset,
          };
        }),
    });
  }
}
