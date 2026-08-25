import {
  pgTable,
  text,
  bigint,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";

/**
 * Origin of an entity record — how it was created.
 * - `sync`: imported via connector sync (e.g. CSV import)
 * - `manual`: created via REST API / UI
 * - `portal`: created by an LLM tool during a portal session
 */
export const entityRecordOriginEnum = pgEnum("entity_record_origin", [
  "sync",
  "manual",
  "portal",
]);

export type EntityRecordOrigin =
  (typeof entityRecordOriginEnum.enumValues)[number];

/**
 * Entity records table.
 *
 * Each row represents the transactional shape of a single record:
 * identity (`source_id`, `connector_entity_id`), sync metadata
 * (`synced_at`, `checksum`, `validation_errors`, `is_valid`), and the
 * raw `data` JSONB (the connector's pre-mapping payload — preserved
 * as the audit trail). The mapped, typed projection lives in the
 * per-entity wide table `er__<connector_entity_id>`; Phase 2 slice 6
 * dropped the redundant `normalized_data` JSONB.
 */
export const entityRecords = pgTable(
  "entity_records",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    sourceId: text("source_id").notNull(),
    checksum: text("checksum").notNull(),
    syncedAt: bigint("synced_at", { mode: "number" }).notNull(),
    origin: entityRecordOriginEnum("origin").notNull().default("manual"),
    validationErrors:
      jsonb("validation_errors").$type<{ field: string; error: string }[]>(),
    isValid: boolean("is_valid").notNull(),
  },
  (table) => [
    uniqueIndex("entity_records_entity_source_unique")
      .on(table.connectorEntityId, table.sourceId)
      .where(sql`deleted IS NULL`),
    index("entity_records_entity_synced_at_idx").on(
      table.connectorEntityId,
      table.syncedAt
    ),
    // #433: the list endpoint's default sort. `created` is `usePagination`'s
    // `defaultSortBy` for every paginated view, and nothing indexed it — so
    // `WHERE connector_entity_id = ? AND deleted IS NULL ORDER BY created`
    // hash-joined the whole wide table and spilled to disk before taking ten
    // rows. Scope column first (one contiguous range per entity), then the
    // sort key, then `id` as the unique tiebreaker that makes pagination
    // deterministic over ties and lets a keyset cursor seek past a position.
    // Partial on `deleted IS NULL` to match the soft-delete guard every read
    // carries.
    index("entity_records_entity_created_id_idx")
      .on(table.connectorEntityId, table.created, table.id)
      .where(sql`deleted IS NULL`),
    index("entity_records_entity_is_valid_idx").on(
      table.connectorEntityId,
      table.isValid
    ),
    // #442: the retention purge's predicate — the mirror image of every
    // other index here, which are all partial on `deleted IS NULL` and so
    // exclude precisely the rows a purge reads. Without this the purge is a
    // sequential scan that gets *slower* as it drains: surviving matches
    // thin out, so each `LIMIT` batch scans further for its rows. Measured
    // on a 5.1M-row / 8 GB table at 29ms for the first batch against
    // 1,664ms for a tail batch that scanned everything for a LIMIT it could
    // never satisfy. Partial, so it covers only the tombstones and stays
    // out of the way of live reads.
    index("entity_records_deleted_purge_idx")
      .on(table.deleted)
      .where(sql`deleted IS NOT NULL`),
  ]
);
