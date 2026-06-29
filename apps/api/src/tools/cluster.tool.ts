import { z } from "zod";
import { tool } from "ai";

import { COMPUTE_MAX_ROWS } from "@portalai/core/constants";

import { AnalyticsService } from "../services/analytics.service.js";
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";
import { resolveRecordStream } from "./record-source.js";

const InputSchema = withComputeInput({
  columns: z
    .array(z.string())
    .describe("Numeric columns to cluster on (keys in the rows)"),
  k: z.number().int().min(2).describe("Number of clusters"),
  standardize: z
    .boolean()
    .optional()
    .describe(
      "Z-score each column before clustering. Centroids are returned in original units. Default false."
    ),
  seed: z
    .number()
    .int()
    .optional()
    .describe("Seed for reproducible cluster initialization"),
  maxIterations: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum k-means iterations (default 100)"),
});

export class ClusterTool extends Tool<typeof InputSchema> {
  slug = "cluster";
  name = "Cluster";
  description =
    "Perform k-means clustering on specified numeric columns over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the `columns` and `k`. " +
    "Small datasets get the exact in-memory fit (with per-row cluster assignments); a large query handle folds online via mini-batch k-means — exact-within-tolerance at any N — returning the fitted `centroids` + cluster `sizes` (the O(N) per-row assignments are omitted at scale).";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { queryHandle, rows, ...params } = this.validate(input);

        // Decide exact-in-memory vs streaming mini-batch by source N. Small N
        // (and inline rows, bounded by the transport) gets the exact fit with
        // per-row assignments; a large handle folds online (#153).
        const sourceCount =
          rows != null
            ? rows.length
            : (await PortalSqlHandleService.getMeta(queryHandle!)).rowCount;

        if (queryHandle == null || sourceCount <= COMPUTE_MAX_ROWS) {
          const records = await resolveComputeRecords({ queryHandle, rows });
          return AnalyticsService.cluster({
            records,
            columns: params.columns,
            k: params.k,
            standardize: params.standardize,
            seed: params.seed,
            maxIterations: params.maxIterations,
          });
        }

        // Streaming mini-batch — order by the first column so the cursor has
        // a stable keyset (the fit is order-tolerant; k-means has no semantic
        // order). Bounded memory: k centroids + counts.
        const stream = resolveRecordStream(
          { queryHandle },
          { mode: "streaming" },
          { orderBy: params.columns[0] }
        );
        return AnalyticsService.clusterFromStream(stream, {
          columns: params.columns,
          k: params.k,
          standardize: params.standardize,
        });
      },
    });
  }
}
