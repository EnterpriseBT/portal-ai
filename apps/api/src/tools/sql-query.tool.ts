import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  sql: z.string().describe("The SQL query to execute"),
});

export class SqlQueryTool extends Tool<typeof InputSchema> {
  slug = "sql_query";
  name = "SQL Query Tool";
  description =
    "Executes a SQL query against a specified database connection and returns the results as JSON.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { sql } = this.validate(input);
        return AnalyticsService.sqlQuery({ sql, stationId });
      },
    });
  }
}
