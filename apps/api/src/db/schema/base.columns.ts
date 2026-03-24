import { text, bigint, type PgColumnBuilderBase } from "drizzle-orm/pg-core";
import { CoreSchema, type Core } from "@portalai/core/models";
import { z } from "zod";

// ── Helpers ─────────────────────────────────────────────────────────

/** Convert a camelCase key to snake_case for the DB column name. */
function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/**
 * Unwrap `.nullable()` / `.optional()` wrappers and return the inner
 * Zod type together with a flag indicating whether the field is nullable.
 */
function unwrap(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  nullable: boolean;
} {
  if (schema instanceof z.ZodNullable) {
    return {
      inner: (schema as z.ZodNullable<z.ZodTypeAny>).unwrap(),
      nullable: true,
    };
  }
  if (schema instanceof z.ZodOptional) {
    return {
      inner: (schema as z.ZodOptional<z.ZodTypeAny>).unwrap(),
      nullable: true,
    };
  }
  return { inner: schema, nullable: false };
}

// ── Type reference ──────────────────────────────────────────────────
// A never-executed block that gives TypeScript the exact column types.
// We use this to cast the dynamically-built columns below.

function _typeRef() {
  return {
    id: text("id").primaryKey(),
    created: bigint("created", { mode: "number" }).notNull(),
    createdBy: text("created_by").notNull(),
    updated: bigint("updated", { mode: "number" }),
    updatedBy: text("updated_by"),
    deleted: bigint("deleted", { mode: "number" }),
    deletedBy: text("deleted_by"),
  };
}
type BaseColumns = ReturnType<typeof _typeRef>;

// ── Column builder ──────────────────────────────────────────────────

/**
 * Derive Drizzle base columns directly from `CoreSchema` defined
 * in `@portalai/core`.
 *
 * The mapping is intentionally kept simple — every field in Core
 * is either a `string` (→ `text`) or a `number` (→ `bigint`).
 * The `id` key is always the primary key.
 *
 * Usage: spread into any pgTable definition:
 *   pgTable("my_table", { ...baseColumns, myField: text("my_field") })
 */
function deriveBaseColumns(): BaseColumns {
  const shape = CoreSchema.shape;
  const columns: Record<string, PgColumnBuilderBase> = {};

  for (const [key, zodField] of Object.entries(shape)) {
    const col = toSnakeCase(key);
    const { inner, nullable } = unwrap(zodField as unknown as z.ZodTypeAny);

    if (inner instanceof z.ZodNumber) {
      const c = bigint(col, { mode: "number" });
      columns[key] = nullable ? c : c.notNull();
    } else {
      const c = text(col);
      if (key === "id") {
        columns[key] = c.primaryKey();
      } else {
        columns[key] = nullable ? c : c.notNull();
      }
    }
  }

  return columns as BaseColumns;
}

export const baseColumns = deriveBaseColumns();

// ── Compile-time guard ──────────────────────────────────────────────
// Ensure every key in Core has a corresponding column and vice-versa.
// If a field is added to / removed from CoreSchema without updating
// the type reference above, TypeScript will error here.
type _KeysMatch = keyof typeof baseColumns extends keyof Core
  ? keyof Core extends keyof typeof baseColumns
    ? true
    : never
  : never;
const _keysMatch: _KeysMatch = true;
void _keysMatch;
