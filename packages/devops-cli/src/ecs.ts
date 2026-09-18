/**
 * ECS one-off tasks (#192, #581) — read the live service's network config +
 * task definition, run a FARGATE one-off with the container command overridden,
 * wait for it to stop, and surface the container exit code. `runSeedTask` runs
 * `npm run db:seed:ci`; `runUpgradeTask` runs `npm run db:upgrade:ci`. Both
 * scripts must keep existing in apps/api — they run INSIDE the container.
 */

import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  waitUntilTasksStopped,
} from "@aws-sdk/client-ecs";
import {
  clusterName,
  EnvInfraError,
  EnvNotConfiguredError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

const SEED_COMMAND = ["npm", "run", "db:seed:ci"];
const UPGRADE_COMMAND = ["npm", "run", "db:upgrade:ci"];
const WAIT_MAX_SECONDS = 900;

export interface OneOffTaskResult {
  taskArn: string;
  exitCode: number;
}

// Preserved names for existing consumers.
export type SeedTaskResult = OneOffTaskResult;
export type UpgradeTaskResult = OneOffTaskResult;

interface OneOffSpec {
  command: string[];
  /** Capitalized noun for error messages ("Seed" / "Upgrade"). */
  label: string;
  /** The "run it locally instead" hint for an env with no ECS. */
  localHint: string;
}

async function runOneOffTask(
  def: EnvironmentDefinition,
  spec: OneOffSpec
): Promise<OneOffTaskResult> {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `"${def.name}" has no deployed ECS service — ${spec.localHint}`
    );
  }

  const cluster = clusterName(def);
  const service = `portalai-api-${def.aws.envName}`;
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
  const containerName = taskDef.taskDefinition?.containerDefinitions?.[0]?.name;
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
  if (exitCode !== 0) {
    throw new EnvInfraError(
      `${spec.label} task exited with code ${exitCode}. Check CloudWatch logs for details (task ${taskArn}).`
    );
  }
  return { taskArn, exitCode };
}

export function runSeedTask(
  def: EnvironmentDefinition
): Promise<SeedTaskResult> {
  return runOneOffTask(def, {
    command: SEED_COMMAND,
    label: "Seed",
    localHint: "seed local with `npm run db:seed` (apps/api)",
  });
}

export function runUpgradeTask(
  def: EnvironmentDefinition
): Promise<UpgradeTaskResult> {
  return runOneOffTask(def, {
    command: UPGRADE_COMMAND,
    label: "Upgrade",
    localHint: "upgrade local with `npm run db:upgrade` (apps/api)",
  });
}
