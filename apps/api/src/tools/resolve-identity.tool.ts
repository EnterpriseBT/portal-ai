import { z } from "zod";
import { tool } from "ai";

import {
  AnalyticsService,
  type EntityGroupContext,
} from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  entityGroupName: z.string().describe("Name of the Entity Group"),
  linkValue: z
    .string()
    .describe("The link value to search for across member entities"),
});

export class ResolveIdentityTool extends Tool<typeof InputSchema> {
  slug = "resolve_identity";
  name = "Resolve Identity";
  description =
    "Find the records across an Entity Group's member entities that share a link value, as the current user can see them. " +
    "Returns one match per curated view (`viewKey`, the name to use in `sql_query`), primary entity first. " +
    "Records use the same column names as `sql_query` (`c_<key>`) and are capped at 100 per match " +
    "(`truncated: true` means more exist — narrow with `sql_query`). Only groups listed in `station_context` resolve.";

  get schema() {
    return InputSchema;
  }

  /** #658: built per caller — resolution runs through `userId`'s granted
   *  curated views on this station, re-resolved on every call. */
  build(
    stationId: string,
    organizationId: string,
    userId: string,
    entityGroups: EntityGroupContext[]
  ) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entityGroupName, linkValue } = this.validate(input);
        return AnalyticsService.resolveIdentity({
          stationId,
          organizationId,
          userId,
          entityGroupName,
          linkValue,
          entityGroups,
        });
      },
    });
  }
}
