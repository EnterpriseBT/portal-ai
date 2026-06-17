import {
  pgTable,
  text,
  jsonb,
  bigint,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type { ToolCapability } from "@portalai/core/models";

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
 * fetch failed).
 *
 * `auth_headers` is an opaque ciphertext blob produced by
 * `encryptCredentials()` (AES-256-GCM, see `utils/crypto.util.ts`).
 * The repository decrypts on every read so route handlers and
 * `tools.service` see a `Record<string, string> | null` plaintext
 * map. API responses still redact to `{has: true/false}` —
 * plaintext never crosses the API boundary.
 *
 * `signing_secret` follows the same encrypted-at-rest pattern.
 * Generated server-side at registration (Stripe-style `whsec_*`),
 * surfaced once in the registration response, then never returned
 * by GET endpoints. Used to HMAC every outbound webhook call so
 * toolpack servers can verify the request came from us. Rotation
 * via POST /api/toolpacks/:id/rotate-signing-secret invalidates the
 * old secret immediately and returns a fresh one once.
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
    authHeaders: text("auth_headers"),
    signingSecret: text("signing_secret").notNull(),
    tools: jsonb("tools")
      .$type<
        Array<{
          name: string;
          description: string;
          parameterSchema: Record<string, unknown>;
          /** Optional bulk-dispatch metadata declared by the schema
           *  endpoint (#85 Phase 4 + webhook bulkDispatch). When
           *  present, the tool is eligible for
           *  `bulk_transform_entity_records` with
           *  `expression.kind === "tool"`. */
          bulkDispatch?: {
            maxConcurrency: number;
            timeoutMs: number;
            ratePerSec?: number;
            idempotent: boolean;
            estimatedMsPerCall?: number;
            costHint?: "free" | "metered" | "expensive";
          };
          /** Optional declared capability (#121); custom tools carry the
           *  pure-consumer subset, validated at registration. */
          capability?: ToolCapability;
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
