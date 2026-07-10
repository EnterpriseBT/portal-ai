/**
 * ECS one-off seed task (#192) — ports api-cli.sh:235-286 verbatim onto the
 * AWS SDK: read the live service's network config + task definition, run a
 * FARGATE one-off with the command overridden to `npm run db:seed:ci` (the
 * script that must keep existing in apps/api — it runs INSIDE the container),
 * wait for it to stop, and surface the container exit code.
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
const WAIT_MAX_SECONDS = 900;

export interface SeedTaskResult {
  taskArn: string;
  exitCode: number;
}

export async function runSeedTask(
  def: EnvironmentDefinition
): Promise<SeedTaskResult> {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `"${def.name}" has no deployed ECS service — seed local with \`npm run db:seed\` (apps/api)`
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
    throw new EnvInfraError(`Task definition ${svc.taskDefinition} has no containers`);
  }

  const run = await client.send(
    new RunTaskCommand({
      cluster,
      taskDefinition: svc.taskDefinition,
      networkConfiguration: svc.networkConfiguration,
      launchType: "FARGATE",
      overrides: {
        containerOverrides: [{ name: containerName, command: SEED_COMMAND }],
      },
    })
  );
  const taskArn = run.tasks?.[0]?.taskArn;
  if (!taskArn) {
    throw new EnvInfraError(`Could not start the seed task in ${cluster}`);
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
      `Seed task exited with code ${exitCode}. Check CloudWatch logs for details (task ${taskArn}).`
    );
  }
  return { taskArn, exitCode };
}
