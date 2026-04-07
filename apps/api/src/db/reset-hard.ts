import { sql } from "drizzle-orm";

import { closeDatabase, db } from "./client.js";

async function main() {
  const result = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);

  const tableNames = result.map((row) => row.tablename);

  if (tableNames.length === 0) {
    console.log("No tables found.");
    return;
  }

  console.log(`Truncating ${tableNames.length} tables: ${tableNames.join(", ")}`);

  await db.execute(
    sql.raw(`TRUNCATE TABLE ${tableNames.map((t) => `"${t}"`).join(", ")} CASCADE`)
  );

  console.log("All tables truncated successfully.");
}

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
