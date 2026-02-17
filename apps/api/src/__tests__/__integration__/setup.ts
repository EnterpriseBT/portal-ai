/**
 * Global setup for integration tests.
 *
 * Connects to the postgres-test container from docker-compose and runs migrations.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function globalSetup() {
  // Use the postgres-test container from docker-compose
  // From inside the dev container, hostname is 'postgres-test'
  // From host machine, it's localhost:5433
  const databaseUrl =
    process.env.INTEGRATION_TEST_DATABASE_URL ||
    "postgresql://postgres:postgres@postgres-test:5432/mcp_ui_test";

  console.log("🔄 Connecting to test database...");
  console.log(`📍 Connection: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);

  // Set environment variable for tests
  process.env.DATABASE_URL = databaseUrl;

  const connection = postgres(databaseUrl, { max: 1 });
  const db = drizzle(connection);

  try {
    // Verify connection
    await connection`SELECT 1`;
    console.log("✅ Database connection established");

    // Clean up existing data
    console.log("🧹 Cleaning up existing data...");
    await db.execute(sql`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // Run migrations
    console.log("🔄 Running migrations...");
    const migrationsPath = join(__dirname, "../../../drizzle");
    await migrate(db, { migrationsFolder: migrationsPath });
    console.log("✅ Migrations completed");
  } catch (error) {
    console.error("❌ Setup failed:", error);
    throw error;
  } finally {
    await connection.end();
  }
}
