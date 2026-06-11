import { sql } from "drizzle-orm";

import { closeDatabase, db } from "./client.js";

/**
 * Partition: `er__*` wide tables are created dynamically by the
 * reconciler (`WideTableReconciler.ensureTable`) per connector
 * entity, not by drizzle migrations. TRUNCATE would only empty
 * them; the row that referenced them in `connector_entities` is
 * about to be wiped, so they'd be left orphaned (#106). Drop them
 * outright — the next reconciler run will recreate the ones it
 * needs.
 */
const WIDE_TABLE_PREFIX = "er__";

export function partitionTables(tableNames: string[]): {
  toDrop: string[];
  toTruncate: string[];
} {
  const toDrop: string[] = [];
  const toTruncate: string[] = [];
  for (const name of tableNames) {
    if (name.startsWith(WIDE_TABLE_PREFIX)) toDrop.push(name);
    else toTruncate.push(name);
  }
  return { toDrop, toTruncate };
}

/**
 * Drop dynamic wide tables + TRUNCATE the rest. Exported for tests;
 * the script's `main()` calls it then closes the connection.
 */
export async function resetHard(): Promise<{
  dropped: string[];
  truncated: string[];
}> {
  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);
  const tableNames = result.map((row) => row.tablename);
  if (tableNames.length === 0) return { dropped: [], truncated: [] };

  const { toDrop, toTruncate } = partitionTables(tableNames);

  if (toDrop.length > 0) {
    await db.execute(
      sql.raw(
        `DROP TABLE ${toDrop.map((t) => `"${t}"`).join(", ")} CASCADE`
      )
    );
  }

  if (toTruncate.length > 0) {
    await db.execute(
      sql.raw(
        `TRUNCATE TABLE ${toTruncate.map((t) => `"${t}"`).join(", ")} CASCADE`
      )
    );
  }

  return { dropped: toDrop, truncated: toTruncate };
}

async function main() {
  const { dropped, truncated } = await resetHard();

  if (dropped.length === 0 && truncated.length === 0) {
    console.log("No tables found.");
    return;
  }

  if (dropped.length > 0) {
    console.log(
      `Dropped ${dropped.length} dynamic wide tables: ${dropped.join(", ")}`
    );
  }
  if (truncated.length > 0) {
    console.log(
      `Truncated ${truncated.length} tables: ${truncated.join(", ")}`
    );
  }
  console.log("Reset complete.");
}

// Only run the reset when invoked as a script (e.g.
// `tsx src/db/reset-hard.ts`). Importing this file from a test
// must NOT kick off main() — `resetHard` and `partitionTables`
// are also exported for direct use.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /\breset-hard\.[cm]?[jt]sx?$/.test(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("Error during reset:", error);
      await closeDatabase();
      process.exit(1);
    });
}
