import {
  pgTable,
  text,
  jsonb,
  bigint,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Organization toolpacks — custom toolpacks registered via the
 * three-endpoint webhook contract (schema + runtime + optional
 * metadata).
 *
 * `tools` caches the schema-endpoint response, validated against the
 * Zod model in `@portalai/core`. `metadata` caches the optional
 * metadata-endpoint response (or `null` if unconfigured / every
 * fetch failed). `auth_headers` is plain jsonb redacted on every
 * read endpoint — actual values are returned only as a presence
 * marker (`{has: true}`) on the wire.
 *
 * Phase 1's `station_toolpacks.organization_toolpack_id` column is
 * already in place but unconstrained; the FK is added in this
 * phase's migration once the target table exists.
 */
export const organizationToolpacks = pgTable(
  "organization_toolpacks",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    endpoints: jsonb("endpoints")
      .$type<{ schema: string; runtime: string; metadata?: string }>()
      .notNull(),
    authHeaders: jsonb("auth_headers").$type<Record<string, string> | null>(),
    tools: jsonb("tools")
      .$type<
        Array<{
          name: string;
          description: string;
          parameterSchema: Record<string, unknown>;
        }>
      >()
      .notNull(),
    metadata: jsonb("metadata").$type<{
      summary?: string;
      tools?: Array<{
        name: string;
        description?: string;
        examples?: Array<{
          title?: string;
          description?: string;
          input?: unknown;
          output?: unknown;
        }>;
      }>;
    } | null>(),
    schemaFetchedAt: bigint("schema_fetched_at", { mode: "number" }).notNull(),
    metadataFetchedAt: bigint("metadata_fetched_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("organization_toolpacks_org_name_unique")
      .on(table.organizationId, table.name)
      .where(sql`deleted IS NULL`),
  ]
);
