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
    "Find all records across an Entity Group's member entities that share a given link value. " +
    "Returns matches grouped by source entity with the primary entity first.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, entityGroups: EntityGroupContext[]) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entityGroupName, linkValue } = this.validate(input);
        return AnalyticsService.resolveIdentity({
          entityGroupName,
          linkValue,
          stationId,
          entityGroups,
        });
      },
    });
  }
}
