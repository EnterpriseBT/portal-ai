/**
 * `portalops jobs …` (#852): the job-queue side of a Redis replacement.
 *
 * `status` reads the `jobs` table, the record of truth, so it works whether
 * or not Redis does. `redispatch` puts every live non-terminal row whose
 * BullMQ entry is gone back on the queue; it runs inside the API image (the
 * only thing that can reach the private Redis) and routes on the env's shape
 * like `db upgrade`. The cutover sequence is in
 * docs/REDIS_ENCRYPTION_CUTOVER.runbook.md.
 */

import postgres from "postgres";

import {
  assertOperationAllowed,
  recordAudit,
  resolveEnvConnection,
  runApiScript,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { runRedispatchTask, type RedispatchTaskResult } from "../ecs.js";
import { guardProdConnect, type ConnectOptions } from "./db.js";
import type { MutateOptions } from "./vars.js";

export interface JobCount {
  status: string;
  type: string;
  count: number;
}

export interface JobsStatusResult {
  counts: JobCount[];
  byStatus: Record<string, number>;
  total: number;
}

export type JobCountReader = (
  def: EnvironmentDefinition
) => Promise<JobCount[]>;

/** Live non-terminal rows by status and type, over the env's DB connection. */
export const readJobCounts: JobCountReader = async (def) => {
  const conn = await resolveEnvConnection(def.name);
  try {
    const db = await conn.db();
    const sql = postgres(db.connectionString, { max: 1 });
    try {
      const rows = await sql<JobCount[]>`
        SELECT status, type, count(*)::int AS count
        FROM jobs
        WHERE deleted IS NULL
          AND status IN ('pending', 'active', 'awaiting_confirmation', 'stalled')
        GROUP BY status, type
        ORDER BY status, type`;
      return [...rows];
    } finally {
      await sql.end();
    }
  } finally {
    await conn.dispose();
  }
};

export async function jobsStatus(
  def: EnvironmentDefinition,
  opts: ConnectOptions,
  read: JobCountReader = readJobCounts
): Promise<JobsStatusResult> {
  guardProdConnect(def, opts);
  const counts = await read(def);
  const byStatus: Record<string, number> = {};
  for (const c of counts)
    byStatus[c.status] = (byStatus[c.status] ?? 0) + c.count;
  return {
    counts,
    byStatus,
    total: counts.reduce((n, c) => n + c.count, 0),
  };
}

/** Rows a worker is executing right now: the drain target before a scale-down. */
export async function countActiveJobs(
  def: EnvironmentDefinition,
  read: JobCountReader = readJobCounts
): Promise<number> {
  return (await read(def))
    .filter((c) => c.status === "active")
    .reduce((n, c) => n + c.count, 0);
}

export type RedispatchResult =
  | ({ via: "ecs" } & RedispatchTaskResult)
  | { via: "local"; script: string };

/**
 * A mutation (prod: `--yes --confirm-prod`). Idempotent by construction: a row
 * already queued is skipped, and a re-add under the row id is a no-op. A dry
 * run is guarded the same (it still starts a task) but isn't audited, since
 * it changes nothing.
 */
export async function jobsRedispatch(
  def: EnvironmentDefinition,
  opts: MutateOptions & { dryRun?: boolean },
  runScript: typeof runApiScript = runApiScript
): Promise<RedispatchResult> {
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });
  const dryRun = !!opts.dryRun;

  let result: RedispatchResult;
  if (def.aws) {
    result = { via: "ecs", ...(await runRedispatchTask(def, { dryRun })) };
  } else {
    await runScript(def, "jobs:redispatch", dryRun ? ["--dry-run"] : []);
    result = { via: "local", script: "jobs:redispatch" };
  }

  if (!dryRun) {
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "jobs redispatch",
      args:
        result.via === "ecs"
          ? { via: result.via, taskArn: result.taskArn }
          : { via: result.via, script: result.script },
    });
  }
  return result;
}
