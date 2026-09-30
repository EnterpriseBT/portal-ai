import { readFileSync } from "node:fs";
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
export function buildMigrationClientOptions(
  resolver: DbPasswordResolver,
  readerRole: string = environment.PORTAL_SQL_READER_ROLE
): {
  max: number;
  password: () => Promise<string>;
  connection: Record<string, string>;
} {
  return {
    max: 1,
    password: () => resolver.resolve(),
    // #660: migration 0118 names the reader role from this setting, so the
    // role it creates is the one the API will SET ROLE to.
    connection: { "portalai.sql_reader_role": readerRole },
  };
}

/** #660: the migration that provisions the restricted SQL reader role. */
const READER_ROLE_MIGRATION = "0118_portal-sql-reader-role.sql";

/** Client options for the privileged provisioning pass: 0118 reads the role
 *  name and the grantee (the app user) from these startup settings. */
export function buildProvisionClientOptions(
  readerRole: string,
  grantee: string,
  password?: string
): {
  max: number;
  connection: Record<string, string>;
  password?: string;
} {
  return {
    max: 1,
    connection: {
      "portalai.sql_reader_role": readerRole,
      "portalai.sql_reader_grantee": grantee,
    },
    // Given to the driver, never interpolated into the URL: a password with
    // `@`, `/` or `:` would otherwise change the host the URL parses to.
    ...(password !== undefined ? { password } : {}),
  };
}

export interface MigrationPlan {
  /** Set when MIGRATE_DATABASE_URL is: run 0118's role DDL as that user,
   *  granting membership to `grantee` (DATABASE_URL's user). */
  provision: { url: string; grantee: string; password?: string } | null;
  /** Schema migrations always run as the app user, so it owns every object
   *  they create. */
  migrate: {
    url: string;
    masterSecretArn: string | undefined;
    fallbackPassword: string;
  };
}

/**
 * #660 PR 2: how a migration run connects. `MIGRATE_DATABASE_URL`, when set,
 * is a privileged user (superuser or CREATEROLE) used for one thing only:
 * provisioning the reader role on the app user's behalf, for installs whose
 * app user can't create roles. It never runs the schema migrations, since
 * whoever runs them owns the tables and the API couldn't read them. Those
 * stay on `DATABASE_URL`, with the #500 master-secret resolver.
 */
export function planMigrations(env: {
  DATABASE_URL: string;
  MIGRATE_DATABASE_URL?: string;
  MIGRATE_DATABASE_PASSWORD?: string;
  DB_MASTER_SECRET_ARN?: string;
}): MigrationPlan {
  const migrate = {
    url: env.DATABASE_URL,
    masterSecretArn: env.DB_MASTER_SECRET_ARN,
    fallbackPassword: fallbackPasswordFromUrl(env.DATABASE_URL),
  };
  if (!env.MIGRATE_DATABASE_URL) return { provision: null, migrate };
  return {
    provision: {
      url: env.MIGRATE_DATABASE_URL,
      grantee: decodeURIComponent(new URL(env.DATABASE_URL).username),
      password: env.MIGRATE_DATABASE_PASSWORD,
    },
    migrate,
  };
}

/** Run 0118's idempotent role DDL as the privileged user. */
async function provisionReaderRole(
  provision: NonNullable<MigrationPlan["provision"]>
): Promise<void> {
  const ddl = readFileSync(
    join(migrationsFolder, READER_ROLE_MIGRATION),
    "utf8"
  );
  const sql = postgres(
    provision.url,
    buildProvisionClientOptions(
      environment.PORTAL_SQL_READER_ROLE,
      provision.grantee,
      provision.password
    )
  );
  try {
    logger.info(
      { grantee: provision.grantee },
      "Provisioning the portal SQL reader role via MIGRATE_DATABASE_URL"
    );
    await sql.unsafe(ddl);
  } finally {
    await sql.end();
  }
}

export async function runMigrations(): Promise<void> {
  const plan = planMigrations(environment);
  if (plan.provision) await provisionReaderRole(plan.provision);

  const target = plan.migrate;
  const resolver = createDbPasswordResolver({
    masterSecretArn: target.masterSecretArn,
    fallbackPassword: target.fallbackPassword,
    ttlMs: environment.DB_PASSWORD_CACHE_TTL_MS,
  });

  const sql = postgres(target.url, buildMigrationClientOptions(resolver));
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
      logger.error({ error }, "Migration failed");
      process.exit(1);
    });
}
