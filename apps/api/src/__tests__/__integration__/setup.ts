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
    // `spatial_ref_sys` is excluded: PostGIS (#316) creates this table in
    // `public` and populates it with ~8500 SRID definitions. It is reference
    // data owned by the extension, not test state — and because `migrate()`
    // below no-ops on a reused container, a TRUNCATE here would never be
    // repopulated, silently stripping ST_Transform of its projection catalog.
    await db.execute(sql`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename NOT LIKE 'er\\_\\_%'
            AND tablename <> 'spatial_ref_sys'
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

    // PostGIS ships `spatial_ref_sys` with thousands of SRID definitions, but the
    // test image can leave the extension installed with an EMPTY catalog — and
    // the migration's `CREATE EXTENSION IF NOT EXISTS postgis` (0076) then no-ops,
    // never populating it. The result: `ST_Transform` loses every projection and
    // all geometry integration tests fail with "Cannot find SRID (3857)". If the
    // catalog is empty, repopulate it from PROJ's own database via
    // `postgis_srs_all()` (PostGIS ≥3.4). This does NOT recreate the extension —
    // a `DROP EXTENSION … CASCADE` would take the migration-created,
    // postgis-dependent helpers (e.g. `portal_try_geom_from_geojson`) with it,
    // which a no-op `migrate()` on a reused container would never restore. (#332)
    const [srs] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM spatial_ref_sys
    `)) as unknown as Array<{ n: number }>;
    if (Number(srs?.n ?? 0) === 0) {
      console.log("🗺️  spatial_ref_sys empty — repopulating from PROJ");
      await db.execute(sql`
        INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
        SELECT auth_srid::int, auth_name, auth_srid::int, srtext, proj4text
        FROM postgis_srs_all()
        WHERE auth_name = 'EPSG' AND auth_srid ~ '^[0-9]+$'
        ON CONFLICT (srid) DO NOTHING
      `);
    }

    // Re-seed data-bearing migration rows the TRUNCATE above wiped. The
    // drizzle journal lives in the `drizzle` schema, so on a reused test
    // container `migrate()` no-ops and never re-runs 0065's `standard`
    // tier INSERT — without this, every org insert (default tier
    // 'standard') violates the organizations_tier FK.
    await db.execute(sql`
      INSERT INTO "tiers" (
        "id", "created", "created_by", "slug", "display_name",
        "period_kind", "period_anchor_day", "overage",
        "free_units_per_period", "free_rate_per_min",
        "metered_units_per_period", "metered_rate_per_min",
        "expensive_units_per_period", "expensive_rate_per_min",
        "per_tool_caps", "stripe_price_id", "selectable",
        "builtin_toolpacks", "custom_toolpacks"
      ) VALUES (
        gen_random_uuid()::text, (extract(epoch from now()) * 1000)::bigint, 'SYSTEM', 'standard', 'Standard',
        'monthly', 1, 'hard-deny',
        NULL, NULL,
        1000, 20,
        100, 5,
        NULL, NULL, true,
        '["data_query","statistics","regression","financial","web_search","entity_management"]'::jsonb, true
      )
      ON CONFLICT ON CONSTRAINT "tiers_slug_unique" DO NOTHING
    `);
    console.log("✅ Default tier ensured");
  } catch (error) {
    console.error("❌ Setup failed:", error);
    throw error;
  } finally {
    await connection.end();
  }
}
