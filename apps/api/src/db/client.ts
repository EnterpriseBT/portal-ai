import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";
import {
  createDbPasswordResolver,
  fallbackPasswordFromUrl,
} from "./credentials.util.js";
import * as schema from "./schema/index.js";

const logger = createLogger({ module: "database" });

/** #500: password resolved per NEW connection from the RDS-managed master
 *  secret (TTL-cached, fail-open), so the weekly managed rotation is
 *  absorbed by running tasks instead of breaking every fresh connection.
 *  Without DB_MASTER_SECRET_ARN (local/dev/test) this is a constant equal
 *  to the URL's own password — behavior identical to a plain URL pool. */
const passwordResolver = createDbPasswordResolver({
  masterSecretArn: environment.DB_MASTER_SECRET_ARN,
  fallbackPassword: fallbackPasswordFromUrl(environment.DATABASE_URL),
  ttlMs: environment.DB_PASSWORD_CACHE_TTL_MS,
});

/**
 * Postgres.js connection instance.
 *
 * Uses the DATABASE_URL from environment. The connection is lazy —
 * no actual TCP connection is made until the first query. The `password`
 * option overrides the URL's embedded password per new connection (#500).
 */
const connection = postgres(environment.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  password: () => passwordResolver.resolve(),
});

/**
 * Drizzle ORM instance with full schema for relational queries.
 */
export const db = drizzle(connection, { schema });

/**
 * Reserve a dedicated connection from the pool. **The caller must release
 * it** — a reserved connection that is never released is permanently gone.
 *
 * Exposed for session-scoped advisory locks (#460), which cannot use a pooled
 * connection: the lock would be released back into the pool still held.
 *
 * **Invariant:** reserved connections must stay well below the pool `max`
 * above. Today at most one is held per running sync, bounded by the jobs
 * worker's `concurrency`. If either that concurrency or this pool size
 * changes, re-check that headroom — the failure mode is connection-acquisition
 * timeouts elsewhere in the app, which will not look like a sync problem.
 */
export const reserveConnection = () => connection.reserve();

/**
 * Verify database connectivity by executing a trivial query.
 * Call this at application startup to fail fast if the DB is unreachable.
 */
export async function connectDatabase(): Promise<void> {
  logger.info("Connecting to database…");
  try {
    await connection`SELECT 1`;
  } catch (err) {
    // A boot-time auth failure may be a rotation the cache hasn't seen —
    // drop it so the caller's retry (or the next task) fetches fresh (#500).
    passwordResolver.invalidate();
    throw err;
  }
  logger.info("Database connection established");
}

/**
 * Gracefully close the database connection pool.
 * Call this on process shutdown.
 */
export async function closeDatabase(): Promise<void> {
  logger.info("Closing database connection pool");
  await connection.end();
}
