import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { Tool } from "../types/tools.js";
import { INLINE_ROWS_THRESHOLD } from "@portalai/core/constants";

const InputSchema = z.object({
  sql: z.string().describe("The SQL query to execute"),
});

export class SqlQueryTool extends Tool<typeof InputSchema> {
  slug = "sql_query";
  name = "SQL Query Tool";
  description =
    "Executes a SQL query and returns the results. Small results (≤ 100 rows) come back inline; larger results return a query-handle envelope { queryHandle, rowCount, schema, samplePeek }. The actual rows for large results stream to the UI directly via the handle — never enter the agent's context. Use aggregations (COUNT, AVG, GROUP BY) when you want a summary; use the envelope's rowCount + samplePeek to reason about large result sets.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { sql } = this.validate(input);

        // Inline path: run the query with the standard row cap. When
        // it fits below INLINE_ROWS_THRESHOLD we return the rows
        // directly (today's behavior + back-compat).
        const inlineResponse = await AnalyticsService.sqlQuery({
          sql,
          stationId,
          organizationId,
        });

        const rowCount = countRows(inlineResponse);
        if (rowCount <= INLINE_ROWS_THRESHOLD) {
          return inlineResponse;
        }

        // Handle path: stage the rows in Redis + return the envelope.
        // The actual data never threads through the agent's context.
        const { envelope } = await PortalSqlHandleService.produce({
          stationId,
          organizationId,
          sql,
        });
        return envelope;
      },
    });
  }
}

/**
 * Count rows across the three PortalSqlResponse shapes. The "sample"
 * variant (payload-too-large collapse) reports total via `totalCount`;
 * the truncated-rows variant likewise; the normal variant returns its
 * own `rows.length`.
 */
function countRows(
  response: Awaited<ReturnType<typeof AnalyticsService.sqlQuery>>
): number {
  if ("sample" in response) {
    return response.totalCount;
  }
  if ("truncated" in response && response.truncated) {
    return response.totalCount;
  }
  return response.rows.length;
}
