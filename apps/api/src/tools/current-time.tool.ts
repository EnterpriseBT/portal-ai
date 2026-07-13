import { z } from "zod";
import { tool } from "ai";

import { DbService } from "../services/db.service.js";
import { Tool } from "../types/tools.js";
import { createLogger } from "../utils/logger.util.js";
import {
  isValidIanaTimezone,
  formatIsoWithOffset,
} from "../utils/timezone.util.js";

const logger = createLogger({ module: "current-time-tool" });

const InputSchema = z
  .object({})
  .describe("No arguments — returns the current server time.");

export class CurrentTimeTool extends Tool<typeof InputSchema> {
  slug = "current_time";
  name = "Current Time";
  description =
    "Return the current date and time. Use this before resolving any " +
    'relative time expression like "today", "this Friday", "next week", ' +
    'or "end of month". The response includes both UTC (`now`) and the ' +
    "organization's local time (`localTime`); resolve relative " +
    "expressions against `localTime`.";

  get schema() {
    return InputSchema;
  }

  build(organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async () => {
        const org =
          await DbService.repository.organizations.findById(organizationId);
        const rawTz = org?.timezone ?? "UTC";
        let timezone: string;
        if (isValidIanaTimezone(rawTz)) {
          timezone = rawTz;
        } else {
          logger.warn(
            { organizationId, badValue: rawTz },
            "Org timezone is not a recognized IANA name, falling back to UTC"
          );
          timezone = "UTC";
        }
        const nowDate = new Date();
        return {
          now: nowDate.toISOString(),
          timezone,
          localTime: formatIsoWithOffset(nowDate, timezone),
        };
      },
    });
  }
}
