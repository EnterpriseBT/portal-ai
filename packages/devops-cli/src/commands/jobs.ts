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

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import postgres from "postgres";

import {
  assertOperationAllowed,
  recordAudit,
  resolveEnvConnection,
  runApiScript,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import {
  runRedispatchTask,
  type RedispatchTaskResult,
  type TaskLogLocation,
} from "../ecs.js";
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

/** The re-dispatch pass's own summary (apps/api `RedispatchSummary`). */
export interface RedispatchSummary {
  acquiredLock: boolean;
  scanned: number;
  redispatched: { id: string; type: string; priorStatus: string }[];
  present: number;
  skippedTerminal: number;
  dryRun: boolean;
}

/**
 * `summary` is what the pass reported: which rows it re-queued, and whether
 * a dry run found any. `null` when it couldn't be read back (a task with no
 * CloudWatch logs, or a log read that failed); the pass itself still ran.
 */
export type RedispatchResult =
  | ({ via: "ecs"; summary: RedispatchSummary | null } & RedispatchTaskResult)
  | { via: "local"; script: string; summary: RedispatchSummary | null };

/** The script prints its summary as one JSON line; find the last one. Logs
 *  around it (pino JSON in a container) carry no `acquiredLock`. */
export function parseRedispatchSummary(text: string): RedispatchSummary | null {
  const lines = text.split("\n").reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<RedispatchSummary>;
      if (typeof parsed.acquiredLock === "boolean") {
        return parsed as RedispatchSummary;
      }
    } catch {
      // not JSON; keep looking
    }
  }
  return null;
}

export type TaskLogReader = (log: TaskLogLocation) => Promise<string>;

/** The task's stdout, from its CloudWatch stream (the tail is enough). */
export const readTaskLog: TaskLogReader = async (log) => {
  const out = await new CloudWatchLogsClient({ region: log.region }).send(
    new GetLogEventsCommand({
      logGroupName: log.group,
      logStreamName: log.stream,
      startFromHead: false,
      limit: 200,
    })
  );
  return (out.events ?? []).map((e) => e.message ?? "").join("\n");
};

/**
 * A mutation (prod: `--yes --confirm-prod`). Idempotent by construction: a row
 * already queued is skipped, and a re-add under the row id is a no-op. A dry
 * run is guarded the same (it still starts a task) but isn't audited, since
 * it changes nothing.
 */
export async function jobsRedispatch(
  def: EnvironmentDefinition,
  opts: MutateOptions & { dryRun?: boolean },
  runScript: typeof runApiScript = runApiScript,
  readLog: TaskLogReader = readTaskLog
): Promise<RedispatchResult> {
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });
  const dryRun = !!opts.dryRun;

  let result: RedispatchResult;
  if (def.aws) {
    const task = await runRedispatchTask(def, { dryRun });
    let summary: RedispatchSummary | null = null;
    if (task.log) {
      try {
        summary = parseRedispatchSummary(await readLog(task.log));
      } catch (err) {
        // The pass already ran; a failed read only costs the readback.
        process.stderr.write(
          `warning: could not read the task log (${task.log.group}/${task.log.stream}): ${(err as Error).message}\n`
        );
      }
    }
    result = { via: "ecs", ...task, summary };
  } else {
    const stdout = await runScript(
      def,
      "jobs:redispatch",
      dryRun ? ["--dry-run"] : []
    );
    result = {
      via: "local",
      script: "jobs:redispatch",
      summary: parseRedispatchSummary(stdout),
    };
  }

  if (!dryRun) {
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "jobs redispatch",
      args:
        result.via === "ecs"
          ? {
              via: result.via,
              taskArn: result.taskArn,
              redispatched: result.summary?.redispatched.length ?? null,
            }
          : {
              via: result.via,
              script: result.script,
              redispatched: result.summary?.redispatched.length ?? null,
            },
    });
  }
  return result;
}
