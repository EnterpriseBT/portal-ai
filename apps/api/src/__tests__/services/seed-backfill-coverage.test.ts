/**
 * Backfill-coverage guard (#581 / #414 enforcement).
 *
 * `seedSystemColumnDefinitions` runs ONLY at org provisioning + reset, so a new
 * `SYSTEM_COLUMN_DEFINITIONS` entry reaches existing orgs only via a paired
 * data-migration (the `0080` pattern). #316 shipped three geospatial keys with
 * a schema-only migration and stranded four app-dev orgs until #414 backfilled
 * them — this guard makes that stranding a build failure instead.
 *
 * The rule: every system-column key must be either in the pre-guard BASELINE
 * (keys that reached existing orgs at provisioning-time, before residency
 * installs existed) or proven-by-migration via a `-- backfill:system-column:<key>`
 * marker in some `drizzle/*.sql`. A new key that is neither fails here.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import SYSTEM_COLUMN_DEFINITIONS without booting the DB layer (same shape as
// seed.service.test.ts).
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      columnDefinitions: { upsertByKey: jest.fn() },
      connectorDefinitions: { upsertManyBySlug: jest.fn() },
    },
    createTransactionClient: jest.fn(),
  },
}));

const { SYSTEM_COLUMN_DEFINITIONS } =
  await import("../../services/seed.service.js");

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../drizzle"
);

/**
 * Keys present when this guard shipped. They reached every existing org via
 * `seedSystemColumnDefinitions` at that org's provisioning time; residency
 * installs are new and get them at provisioning too — so no backfill is owed.
 * The three geospatial keys (#316) are deliberately NOT here: they are proven
 * by the `0080` markers, demonstrating the mechanism a future key must follow.
 */
const BASELINE_SYSTEM_COLUMN_KEYS = new Set<string>([
  "uuid",
  "string_id",
  "number_id",
  "email",
  "phone",
  "url",
  "name",
  "description",
  "text",
  "code",
  "address",
  "status",
  "tag",
  "integer",
  "decimal",
  "percentage",
  "currency",
  "quantity",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json_data",
  "array",
  "reference",
  "reference_array",
]);

const MARKER = /--\s*backfill:system-column:([a-z0-9_]+)/gi;

/** Collect every `-- backfill:system-column:<key>` marker across migrations. */
function backfilledKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith(".sql")
  )) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const m of sql.matchAll(MARKER)) keys.add(m[1]);
  }
  return keys;
}

/** Pure rule: keys that are neither baseline nor proven-by-migration. */
function uncoveredKeys(
  keys: string[],
  baseline: Set<string>,
  backfilled: Set<string>
): string[] {
  return keys.filter((k) => !baseline.has(k) && !backfilled.has(k));
}

describe("system-column backfill coverage", () => {
  const allKeys = SYSTEM_COLUMN_DEFINITIONS.map((d: { key: string }) => d.key);

  it("every system column key is baseline or proven by a backfill migration", () => {
    const gaps = uncoveredKeys(
      allKeys,
      BASELINE_SYSTEM_COLUMN_KEYS,
      backfilledKeys()
    );
    expect(gaps).toEqual([]);
  });

  it("flags a new key that has neither a baseline entry nor a backfill", () => {
    const gaps = uncoveredKeys(
      [...allKeys, "brand_new_column"],
      BASELINE_SYSTEM_COLUMN_KEYS,
      backfilledKeys()
    );
    expect(gaps).toContain("brand_new_column");
  });

  it("discovers the 0080 geospatial backfill markers", () => {
    const backfilled = backfilledKeys();
    expect(backfilled.has("geometry")).toBe(true);
    expect(backfilled.has("latitude")).toBe(true);
    expect(backfilled.has("longitude")).toBe(true);
  });
});
