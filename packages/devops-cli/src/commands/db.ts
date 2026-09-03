/**
 * `portalops db …` (#192). Library-first command bodies; bin.ts wires flags.
 * Connect-class commands (tunnel/psql) are not mutations, but opening a
 * connection INTO PRODUCTION is a deliberate act — they require
 * `--confirm-prod` there (reviewed decision, discovery OQ2).
 */

import { spawn } from "node:child_process";

import {
  assertOperationAllowed,
  composeDatabaseUrl,
  putSecret,
  recordAudit,
  resolveEnvConnection,
  runApiScript,
  EnvConfirmationRequiredError,
  EnvInfraError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { runReset, type ResetResult } from "../reset.js";
import { runSeedTask, type SeedTaskResult } from "../ecs.js";
import type { MutateOptions } from "./vars.js";

export interface ConnectOptions {
  confirmProd?: boolean;
  localPort?: number;
  /** #500: database-name override for the composed connection — the §10
   *  bootstrap escape hatch (`postgres` before `portal_ai` exists). */
  dbName?: string;
}

/** Prod connect barrier: connecting to production requires --confirm-prod. */
function guardProdConnect(
  def: EnvironmentDefinition,
  opts: ConnectOptions
): void {
  if (def.kind === "production" && !opts.confirmProd) {
    throw new EnvConfirmationRequiredError(
      `Connecting to production environment "${def.name}" requires the production barrier flag (--confirm-prod)`
    );
  }
}

// ── tunnel ───────────────────────────────────────────────────────────

export interface TunnelHandle {
  connectionString: string;
  dispose(): Promise<void>;
}

/** Open the env's DB path (local: .env passthrough; AWS: SSM tunnel). The
 *  caller (bin) prints the psql hint and holds the process open. */
export async function dbTunnel(
  def: EnvironmentDefinition,
  opts: ConnectOptions
): Promise<TunnelHandle> {
  guardProdConnect(def, opts);
  const conn = await resolveEnvConnection(def.name);
  const db = await conn.db({ dbName: opts.dbName });
  return {
    connectionString: db.connectionString,
    dispose: () => conn.dispose(),
  };
}

// ── url (#384) ───────────────────────────────────────────────────────

export interface DbUrlOptions extends MutateOptions {
  /** Database name. Defaults to `portal_ai` — dev's value, and the database
   *  an operator must CREATE by hand since `database.yml` sets no DBName, so
   *  RDS provisions only the `postgres` maintenance database. Pass `postgres`
   *  to reach that one during bootstrap, before `portal_ai` exists. */
  dbName?: string;
  /** Appended as `?sslmode=<mode>`. Defaults to `require`, matching dev. */
  sslMode?: string;
  /** Store the composed value at the `database-url` secret. */
  write?: boolean;
}

export interface DbUrlResult {
  /** ALWAYS password-redacted (`***`). There is no flag that returns the real
   *  value: it exists only in Secrets Manager. `--json` serializes this whole
   *  object, so anything carried here is published to stdout. */
  connectionString: string;
  endpoint: string;
  port: number;
  written: boolean;
  /** A NEW secret was created — its ARN must reach the deploy workflow. */
  created: boolean;
}

/**
 * Compose the env's DATABASE_URL from the database stack's exports and the
 * RDS-managed master credential — via cli-env's `composeDatabaseUrl` (#500),
 * the shared always-current path `connection.db()` also uses.
 *
 * Why this exists: `ManageMasterUserPassword` has RDS mint the password into
 * its own secret, so assembling the connection string by hand means routing a
 * production database password through a console, a clipboard and a shell.
 * Here it moves AWS-API to AWS-API and is never rendered — the default output
 * redacts it, and `--write` sends it straight to Secrets Manager. Since #500
 * the stored `database-url` copy is a BOOTSTRAP artifact (ECS injects it for
 * host/user/dbname; the app resolves the password at connect time), so its
 * password going stale at the next rotation no longer degrades anything.
 */
export async function dbUrl(
  def: EnvironmentDefinition,
  opts: DbUrlOptions = {}
): Promise<DbUrlResult> {
  const { url, redactedUrl, endpoint, port, dbName } = await composeDatabaseUrl(
    def,
    { dbName: opts.dbName, sslMode: opts.sslMode }
  );

  if (!opts.write) {
    return {
      connectionString: redactedUrl,
      endpoint,
      port,
      written: false,
      created: false,
    };
  }

  // Guard BEFORE the write — never after composing.
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });
  const { created } = await putSecret(def, "database-url", url);
  await recordAudit({
    env: def.name,
    operator: "portalops",
    command: "db url --write",
    // Endpoint and created only: the value is the whole point of the command.
    args: { endpoint, dbName, created },
  });

  // The REDACTED form, even on the write path. The caller has no use for the
  // real value — it went to Secrets Manager — and `--json` prints whatever is
  // returned, so returning it here published the production database password
  // to stdout and into any CI log that ran this command.
  return {
    connectionString: redactedUrl,
    endpoint,
    port,
    written: true,
    created,
  };
}

// ── psql ─────────────────────────────────────────────────────────────

export type PsqlSpawner = (cmd: string, args: string[]) => Promise<number>;

/** Default spawner: interactive psql with inherited stdio. */
export const interactivePsql: PsqlSpawner = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        new EnvInfraError(
          e.code === "ENOENT"
            ? "Could not spawn psql — install the PostgreSQL client tools"
            : `psql failed: ${e.message}`,
          { cause: e }
        )
      )
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

/** psql through the env connection: REPL by default, one-shot via
 *  passthrough args (`portalops db psql --env x -- -tAc "select 1"`). */
export async function dbPsql(
  def: EnvironmentDefinition,
  opts: ConnectOptions & { args: string[] },
  spawner: PsqlSpawner = interactivePsql
): Promise<{ exitCode: number }> {
  guardProdConnect(def, opts);
  const conn = await resolveEnvConnection(def.name);
  try {
    const db = await conn.db({ dbName: opts.dbName });
    let exitCode: number;
    try {
      exitCode = await spawner("psql", [db.connectionString, ...opts.args]);
    } catch (err) {
      if (err instanceof EnvInfraError) throw err;
      throw new EnvInfraError(
        (err as NodeJS.ErrnoException)?.code === "ENOENT"
          ? "Could not spawn psql — install the PostgreSQL client tools"
          : `psql failed: ${(err as Error)?.message}`,
        { cause: err }
      );
    }
    return { exitCode };
  } finally {
    await conn.dispose();
  }
}

// ── reset / seed / reset-seed ────────────────────────────────────────

export function dbReset(
  def: EnvironmentDefinition,
  opts: MutateOptions
): Promise<ResetResult> {
  return runReset(def, opts); // destructive guard + audit live in runReset
}

/** Which way the seed ran — the env's shape decides, not a flag. */
export type SeedResult =
  | ({ via: "ecs" } & SeedTaskResult)
  | { via: "local"; script: string };

/**
 * Seed — a mutation (idempotent system-def upserts), dispatched on whether
 * the env has a deployed service (#295).
 *
 * Deployed envs run `db:seed:ci` as an ECS one-off inside the container.
 * Local has no ECS to run anything on, so it spawns the app's own
 * `db:seed` script against the env's database — the same route
 * `portalai org create` / `org reset` take. Before this split the ECS path
 * was the only one, so `db seed --env local` threw and, worse,
 * `db reset-seed --env local` threw *after* wiping the database.
 */
export async function dbSeed(
  def: EnvironmentDefinition,
  opts: MutateOptions,
  runScript: typeof runApiScript = runApiScript
): Promise<SeedResult> {
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

  let result: SeedResult;
  if (def.aws) {
    result = { via: "ecs", ...(await runSeedTask(def)) };
  } else {
    await runScript(def, "db:seed", []);
    result = { via: "local", script: "db:seed" };
  }

  await recordAudit({
    env: def.name,
    operator: "portalops",
    command: "db seed",
    args:
      result.via === "ecs"
        ? { via: result.via, taskArn: result.taskArn }
        : { via: result.via, script: result.script },
  });
  return result;
}

/**
 * Total wipe + re-seed, identical in meaning for every env: TRUNCATE
 * everything (dropping the dynamic `er__*` tables outright), then restore
 * the system rows a truncate removes — the `standard` tier row the
 * `organizations.tier` FK needs, and the connector definitions. The schema
 * and `__drizzle_migrations` survive, so no migration step is involved.
 */
export async function dbResetSeed(
  def: EnvironmentDefinition,
  opts: MutateOptions,
  runScript: typeof runApiScript = runApiScript
): Promise<{ reset: ResetResult; seed: SeedResult }> {
  const reset = await runReset(def, opts);
  const seed = await dbSeed(def, opts, runScript);
  return { reset, seed };
}
