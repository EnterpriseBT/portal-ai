/**
 * ECS one-off tasks against an env's API service (#192, #581, #1088).
 *
 * Reads the live service's network config and task definition, runs a FARGATE
 * one-off with the container command overridden, waits for it to stop, and
 * surfaces the container exit code. Each runs a built apps/api script with
 * `node`: the runtime image has no npm (#573 removed it), so `npm run …` fails
 * there (#852). The scripts must keep existing in apps/api, since they run
 * INSIDE the container.
 *
 * Why a task and not a local spawn (`runApiScript`): the task carries the
 * env's whole runtime config (Redis, S3, Stripe), where a spawn gets only the
 * env's database, encryption key and system id and takes the rest from the
 * operator's local `.env`. A script that touches more than the database (an
 * org deletion cancels queued jobs, deletes uploads and cancels the Stripe
 * subscription) must run here on an AWS env (#1088).
 *
 * Lived in devops-cli until #1088 moved it here so `portalai` can route its
 * deletes the same way. Callers route by env shape: an env with `aws` runs
 * the task, `local` spawns.
 */

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  waitUntilTasksStopped,
} from "@aws-sdk/client-ecs";

import { EnvInfraError, EnvNotConfiguredError } from "./errors.js";
import { clusterName, type EnvironmentDefinition } from "./registry.js";

const WAIT_MAX_SECONDS = 900;
/** How many of the script's own error lines a failure carries. */
const FAILURE_LINES = 5;

/** Where a one-off task's stdout landed (the task definition's awslogs). */
export interface TaskLogLocation {
  region: string;
  group: string;
  stream: string;
}

export interface ApiTaskResult {
  taskArn: string;
  exitCode: number;
  /** Present when the task definition logs to CloudWatch (awslogs). */
  log?: TaskLogLocation;
}

export interface ApiTaskSpec {
  /** The container command, e.g. `["node", "dist/db/seed.js"]`. */
  command: string[];
  /** Capitalized noun for error messages ("Seed" / "Org delete"). */
  label: string;
  /** The "run it locally instead" hint for an env with no ECS. */
  localHint: string;
}

export type TaskLogReader = (log: TaskLogLocation) => Promise<string>;

/** The task's output, from its CloudWatch stream (the tail is enough). */
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

/** The API's ECS service. The one place its name is built (#852). */
export const apiServiceName = (def: EnvironmentDefinition): string => {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `"${def.name}" has no deployed ECS service`
    );
  }
  return `portalai-api-${def.aws.envName}`;
};

/**
 * The script's own error lines from a log tail. The app logs pino JSON, one
 * object per line, so a line that isn't JSON is the script talking.
 */
export function scriptErrorLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("{"))
    .slice(-FAILURE_LINES);
}

export async function runApiTask(
  def: EnvironmentDefinition,
  spec: ApiTaskSpec,
  readLog: TaskLogReader = readTaskLog
): Promise<ApiTaskResult> {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `"${def.name}" has no deployed ECS service — ${spec.localHint}`
    );
  }

  const cluster = clusterName(def);
  const service = apiServiceName(def);
  const client = new ECSClient({ region: def.aws.region });

  const services = await client.send(
    new DescribeServicesCommand({ cluster, services: [service] })
  );
  const svc = services.services?.[0];
  if (!svc?.networkConfiguration || !svc.taskDefinition) {
    throw new EnvInfraError(
      `Could not read service config for ${service} in ${cluster} — is the service deployed?`
    );
  }

  const taskDef = await client.send(
    new DescribeTaskDefinitionCommand({ taskDefinition: svc.taskDefinition })
  );
  const container = taskDef.taskDefinition?.containerDefinitions?.[0];
  const containerName = container?.name;
  if (!containerName) {
    throw new EnvInfraError(
      `Task definition ${svc.taskDefinition} has no containers`
    );
  }

  const run = await client.send(
    new RunTaskCommand({
      cluster,
      taskDefinition: svc.taskDefinition,
      networkConfiguration: svc.networkConfiguration,
      launchType: "FARGATE",
      overrides: {
        containerOverrides: [{ name: containerName, command: spec.command }],
      },
    })
  );
  const taskArn = run.tasks?.[0]?.taskArn;
  if (!taskArn) {
    throw new EnvInfraError(
      `Could not start the ${spec.label.toLowerCase()} task in ${cluster}`
    );
  }

  await waitUntilTasksStopped(
    { client, maxWaitTime: WAIT_MAX_SECONDS },
    { cluster, tasks: [taskArn] }
  );

  const done = await client.send(
    new DescribeTasksCommand({ cluster, tasks: [taskArn] })
  );
  const exitCode = done.tasks?.[0]?.containers?.[0]?.exitCode ?? -1;

  // awslogs names a task's stream `<prefix>/<container>/<task id>`.
  const logOptions = container?.logConfiguration?.options;
  const group = logOptions?.["awslogs-group"];
  const prefix = logOptions?.["awslogs-stream-prefix"];
  const log: TaskLogLocation | undefined =
    container?.logConfiguration?.logDriver === "awslogs" && group && prefix
      ? {
          region: logOptions?.["awslogs-region"] ?? def.aws.region,
          group,
          stream: `${prefix}/${containerName}/${taskArn.split("/").pop()}`,
        }
      : undefined;

  if (exitCode !== 0) {
    // Bring the script's reason back with the failure (a refusal names the
    // job that blocks it), so the operator needn't open CloudWatch for it.
    // Best effort: an unreadable log only costs the reason.
    let reason: string[] = [];
    if (log) {
      try {
        reason = scriptErrorLines(await readLog(log));
      } catch {
        // fall through to the pointer below
      }
    }
    const where = log
      ? `CloudWatch ${log.group}/${log.stream}`
      : `CloudWatch logs for task ${taskArn}`;
    throw new EnvInfraError(
      reason.length > 0
        ? `${spec.label} task exited with code ${exitCode}: ${reason.join("\n")} (${where})`
        : `${spec.label} task exited with code ${exitCode}. Check ${where} for details.`
    );
  }
  return { taskArn, exitCode, ...(log ? { log } : {}) };
}
