/**
 * #956: the system principal a database was provisioned with.
 *
 * `SYSTEM_ID` is write-once: every platform row carries it as `createdBy`, and
 * `created_by_system` grants match only the current value
 * (`services/permission-set.ts`). A changed value would strand every such row
 * and quietly cost members read on everything the platform provisioned. So
 * the database records the principal in `system_principal` (one row, migration
 * 0134), and the migration runner and the API boot refuse another.
 *
 * Raw SQL through a small runner, not a Drizzle table: one internal value that
 * no feature reads, used by `db-migrate` (its own postgres-js client) and the
 * API boot (a reserved connection) alike.
 */

/** Runs one parameterized statement and returns its rows. */
export type SqlRunner = (
  text: string,
  params?: unknown[]
) => Promise<ReadonlyArray<Record<string, unknown>>>;

export class SystemPrincipalMismatchError extends Error {
  constructor(
    readonly configured: string,
    readonly recorded: string
  ) {
    super(
      `SYSTEM_ID ${JSON.stringify(configured)} doesn't match the ` +
        `${JSON.stringify(recorded)} this database was provisioned with. ` +
        `SYSTEM_ID is write-once: a new value would strand every platform ` +
        `row written under the old one. Restore SYSTEM_ID=${JSON.stringify(recorded)} (#956).`
    );
    this.name = "SystemPrincipalMismatchError";
  }
}

/** Throws when a principal is recorded and it isn't `systemId`. */
export async function assertSystemPrincipal(
  read: () => Promise<string | null>,
  systemId: string
): Promise<void> {
  const recorded = await read();
  if (recorded !== null && recorded !== systemId) {
    throw new SystemPrincipalMismatchError(systemId, recorded);
  }
}

/** The recorded principal; null before 0134 or when no row is recorded. */
export async function readSystemPrincipal(
  run: SqlRunner
): Promise<string | null> {
  const [exists] = await run(
    "SELECT to_regclass('public.system_principal') IS NOT NULL AS present"
  );
  if (!exists?.present) return null;
  const [row] = await run("SELECT id FROM system_principal LIMIT 1");
  return typeof row?.id === "string" ? row.id : null;
}

/**
 * Records `systemId` when nothing is recorded (a table emptied by hand or by
 * a test truncate re-records rather than leaving the guard off). A no-op when
 * a row exists, matching or not: `assertSystemPrincipal` decides that.
 */
export async function recordSystemPrincipal(
  run: SqlRunner,
  systemId: string
): Promise<void> {
  // `singleton` is the primary key and can only be true, so the table holds
  // one row by construction and concurrent first records (two API tasks
  // booting at once) resolve to one winner.
  await run(
    `INSERT INTO system_principal (singleton, id, created)
     VALUES (true, $1, (extract(epoch from now()) * 1000)::bigint)
     ON CONFLICT (singleton) DO NOTHING`,
    [systemId]
  );
}
