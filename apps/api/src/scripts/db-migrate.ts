import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { environment } from "../environment.js";
import {
  createDbPasswordResolver,
  fallbackPasswordFromUrl,
  type DbPasswordResolver,
} from "../db/credentials.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "db-migrate" });

/**
 * Deploy/CI migration entrypoint (#505).
 *
 * `drizzle-kit migrate` (the former `db:migrate:ci`) builds its own postgres-js
 * connection from `drizzle.config.ts`'s static `DATABASE_URL`, so after the RDS
 * master secret rotates it authenticates with the URL's stale embedded password
 * and fails at `CREATE SCHEMA … drizzle` with `28P01`. This script instead
 * reuses the #500 resolver — the SAME per-connection `password` callback the app
 * pool uses (`db/client.ts`) — so a migrate task run after a managed rotation
 * fetches the CURRENT master password. With no `DB_MASTER_SECRET_ARN`
 * (local/dev) the resolver is a constant equal to the URL's own password, so
 * local behavior is byte-identical to a plain-URL connection.
 */

/** `dist/scripts/db-migrate.js` → `../../drizzle` resolves to `/app/drizzle`
 *  in the runtime image and `apps/api/drizzle` when run from source — the
 *  migrations live two levels up from the compiled/source script in every
 *  layout (in-image, local `dist`, local `tsx`). */
const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle"
);

/**
 * postgres-js options that route the password through the #500 resolver rather
 * than the URL's embedded copy. Exported so the unit test can assert the
 * migrate path uses a resolver **callback** (per-connection), not a static
 * password — the regression this fix exists to prevent.
 */
export function buildMigrationClientOptions(resolver: DbPasswordResolver): {
  max: number;
  password: () => Promise<string>;
} {
  return { max: 1, password: () => resolver.resolve() };
}

export async function runMigrations(): Promise<void> {
  const resolver = createDbPasswordResolver({
    masterSecretArn: environment.DB_MASTER_SECRET_ARN,
    fallbackPassword: fallbackPasswordFromUrl(environment.DATABASE_URL),
    ttlMs: environment.DB_PASSWORD_CACHE_TTL_MS,
  });

  const sql = postgres(
    environment.DATABASE_URL,
    buildMigrationClientOptions(resolver)
  );
  try {
    logger.info({ migrationsFolder }, "Running database migrations…");
    await migrate(drizzle(sql), { migrationsFolder });
    logger.info("Migrations completed");
  } finally {
    await sql.end();
  }
}

// Run only as an entrypoint (`node dist/scripts/db-migrate.js`), never on
// import — the unit test imports `buildMigrationClientOptions` without opening
// a DB connection. Under jest, argv[1] is the runner, not this file.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Migration failed"
      );
      process.exit(1);
    });
}
