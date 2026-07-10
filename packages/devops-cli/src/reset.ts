/**
 * Infra DB reset (#192) — ports `apps/api/src/db/reset-hard.ts`, NOT the
 * bash `do_reset`. Semantics (#106): dynamic `er__*` wide tables are created
 * by the reconciler, not migrations — TRUNCATE would orphan them once their
 * `connector_entities` rows are wiped, so they're DROPped outright (the next
 * reconciler run recreates what it needs); everything else TRUNCATEs in one
 * CASCADE statement; `__drizzle_migrations` is never touched.
 *
 * SQL runs through an injectable executor (default: a `psql -tA -c` spawn
 * over the env connection) so the logic is unit-testable and works against
 * every environment — local `.env` DB included.
 */

import { spawn } from "node:child_process";

import {
  assertOperationAllowed,
  recordAudit,
  resolveEnvConnection,
  EnvInfraError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import type { MutateOptions } from "./commands/vars.js";

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

export type SqlExec = (connectionString: string, sql: string) => Promise<string>;

/** Default executor: one-shot psql (tuples-only, unaligned). */
export const psqlExec: SqlExec = (connectionString, sql) =>
  new Promise((resolve, reject) => {
    const child = spawn("psql", [connectionString, "-tA", "-c", sql], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
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
    child.on("exit", (code) =>
      code === 0
        ? resolve(out)
        : reject(new EnvInfraError(`psql exited ${code}: ${err.trim()}`))
    );
  });

export interface ResetResult {
  dropped: string[];
  truncated: string[];
}

/** Destructive: guard first (prod hard-blocked), then partition + wipe. */
export async function runReset(
  def: EnvironmentDefinition,
  opts: MutateOptions,
  exec: SqlExec = psqlExec
): Promise<ResetResult> {
  assertOperationAllowed(def, {
    destructive: true,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

  const conn = await resolveEnvConnection(def.name);
  try {
    const db = await conn.db();
    const listSql =
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '__drizzle_migrations';";
    const tables = (await exec(db.connectionString, listSql))
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);

    const { toDrop, toTruncate } = partitionTables(tables);
    for (const t of toDrop) {
      await exec(db.connectionString, `DROP TABLE "${t}" CASCADE;`);
    }
    if (toTruncate.length > 0) {
      await exec(
        db.connectionString,
        `TRUNCATE TABLE ${toTruncate.map((t) => `"${t}"`).join(", ")} CASCADE;`
      );
    }

    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "db reset",
      args: { dropped: toDrop.length, truncated: toTruncate.length },
    });
    return { dropped: toDrop, truncated: toTruncate };
  } finally {
    await conn.dispose();
  }
}
