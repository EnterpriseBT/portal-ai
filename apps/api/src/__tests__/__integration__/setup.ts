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
    "postgresql://postgres:postgres@postgres-test:5432/portal_ai_test";

  console.log("🔄 Connecting to test database...");
  console.log(`📍 Connection: ${databaseUrl.replace(/:[^:@]+@/, ":****@")}`);

  // Set environment variables for tests
  process.env.DATABASE_URL = databaseUrl;
  process.env.NAMESPACE ??= "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  process.env.SYSTEM_ID ??= "SYSTEM_TEST";
  process.env.AUTH0_WEBHOOK_SECRET ??= "test-webhook-secret";
  process.env.AUTH0_DOMAIN ??= "test.auth0.com";
  process.env.AUTH0_AUDIENCE ??= "https://test-api";
  process.env.CORS_ORIGIN ??= "http://localhost:3000";
  process.env.LOG_LEVEL ??= "silent";
  // Encryption key for connector instance credential tests (32 random bytes, base64)
  process.env.ENCRYPTION_KEY ??= "B6c8MuUiBbxwrAWSopmasgp1TMQ3eTi91aG8Og4TOCQ=";
  // Redis for BullMQ queue integration tests
  process.env.REDIS_URL ??= "redis://redis:6379";

  const connection = postgres(databaseUrl, { max: 1 });
  const db = drizzle(connection);

  try {
    // Verify connection
    await connection`SELECT 1`;
    console.log("✅ Database connection established");

    // Clean up existing data. Drop dynamic `er__*` wide tables one
    // at a time (the reconciler creates them per connector entity;
    // integration runs accumulate hundreds across sessions, and
    // dropping them all in one DO block trips PG's
    // `max_locks_per_transaction` budget). The static schema gets
    // TRUNCATEd in a single transaction; `er__*` tables get recreated
    // on demand by the reconciler.
    console.log("🧹 Cleaning up existing data...");
    const wideTables = (await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'er\\_\\_%'
    `)) as unknown as Array<{ tablename: string }>;
    for (const { tablename } of wideTables) {
      await db.execute(sql.raw(`DROP TABLE "${tablename}" CASCADE`));
    }
    await db.execute(sql`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename NOT LIKE 'er\\_\\_%'
        ) LOOP
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
