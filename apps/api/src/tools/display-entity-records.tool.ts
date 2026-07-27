import { z } from "zod";
import { tool } from "ai";
import { TABLE_DISPLAY_ROW_LIMIT } from "@portalai/core/constants";

import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  entityKey: z
    .string()
    .describe(
      "The entity's table key as listed in `_meta_entities` (e.g. 'parcels', 'contacts'). " +
        "This is the table name to render."
    ),
  columns: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of wide-column names (`c_<normalized_key>`) to project. " +
        "Omit to project every column. Use only when the user explicitly asked " +
        "for fewer columns; for plain 'show me X' requests, omit this."
    ),
});

/**
 * `display_entity_records` — the unambiguous render-this-entity-as-a-
 * table tool. Always goes through the handle path (no inline branch),
 * so the agent has no row-count question to optimize against. Use this
 * for any user "show / display / list" request; `sql_query` stays
 * available for analytical queries (filters, joins, aggregations).
 *
 * Rationale: five rounds of prompt iteration on `sql_query` couldn't
 * stop the agent from issuing defensive LIMIT / OFFSET against a
 * "show all" request. This tool removes the decision: there is no
 * SQL surface to add a LIMIT to, no inline path to optimize for, and
 * no row-count gate.
 */
export class DisplayEntityRecordsTool extends Tool<typeof InputSchema> {
  slug = "display_entity_records";
  name = "Display Entity Records";
  description =
    "Render every record of an entity as a single live table widget for the user. " +
    "Use this tool whenever the user asks to 'show', 'display', 'list', or 'see' an entity " +
    "(e.g. 'show me the parcels', 'list all contacts', 'display the orders'), regardless of " +
    "the entity's row count. The tool internally stages every row through a query-handle and " +
    "the UI renders a single hydrating table — you do not need to paginate, sample, " +
    `or optimize. The table LISTS at most ${TABLE_DISPLAY_ROW_LIMIT.toLocaleString("en-US")} rows and says so itself; ` +
    "every staged row is still available to aggregates and analysis, so never claim the user " +
    "can see them all, and never state a total as if it were the number listed. " +
    "Returns `{queryHandle, rowCount, schema, samplePeek}`; acknowledge the row count in one " +
    `short sentence — e.g. 'Found 5,402 parcels.' when under the limit, or 'Found 10,254 asteroids; the table lists the first ${TABLE_DISPLAY_ROW_LIMIT.toLocaleString("en-US")}.' when over it — then stop. ` +
    "Do not say 'below', 'above' or otherwise place the widget: it is rendered before your " +
    "sentence, and its position is not yours to assert. " +
    "For analytical work (filters, joins, aggregations, derived columns) use `sql_query` instead.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entityKey, columns } = this.validate(input);

        const projection =
          columns && columns.length > 0
            ? columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")
            : "*";
        const safeTable = `"${entityKey.replace(/"/g, '""')}"`;
        const sql = `SELECT ${projection} FROM ${safeTable}`;

        const { envelope } = await PortalSqlHandleService.produce({
          stationId,
          organizationId,
          sql,
        });

        return { type: "data-table", ...envelope };
      },
    });
  }
}
