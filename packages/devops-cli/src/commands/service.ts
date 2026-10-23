/**
 * `portalops service scale` (#852): the API service's task count, set through
 * the backend stack's DesiredCount (never ECS UpdateService, so the stack
 * stays the record of what should run). It is the maintenance-window lever
 * of the Redis cutover: the workers run in the API process, so scaling to
 * zero is what stops both enqueuing and processing.
 */

import { ECSClient, waitUntilServicesStable } from "@aws-sdk/client-ecs";

import {
  assertOperationAllowed,
  clusterName,
  recordAudit,
  EnvConfirmationRequiredError,
  EnvInfraError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { requireDeployed, serviceName, updateStackParams } from "./cache.js";
import { countActiveJobs } from "./jobs.js";
import type { MutateOptions } from "./vars.js";

const SERVICE_WAIT_MAX_SECONDS = 1800;

/**
 * Scaling to zero kills whatever the workers are running. Those rows still
 * re-run through `jobs redispatch`, but a drained queue keeps that the rare
 * path, so scale-to-zero refuses while any job is `active` unless the
 * operator says otherwise.
 */
export async function serviceScale(
  def: EnvironmentDefinition,
  count: number,
  opts: MutateOptions & { allowActive?: boolean },
  countActive: typeof countActiveJobs = countActiveJobs
): Promise<{ service: string; desired: number }> {
  const aws = requireDeployed(def);
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

  if (count === 0 && !opts.allowActive) {
    const active = await countActive(def);
    if (active > 0) {
      throw new EnvConfirmationRequiredError(
        `${active} job(s) are running — wait for \`portalops jobs status\` to show none active, or pass --allow-active (they re-run through \`jobs redispatch\`)`
      );
    }
  }

  await updateStackParams(def, "backend", { DesiredCount: String(count) });

  const service = serviceName(def);
  try {
    await waitUntilServicesStable(
      {
        client: new ECSClient({ region: aws.region }),
        maxWaitTime: SERVICE_WAIT_MAX_SECONDS,
      },
      { cluster: clusterName(def), services: [service] }
    );
  } catch (err) {
    throw new EnvInfraError(
      `${service} did not stabilize at ${count} task(s): ${(err as Error).message}`,
      { cause: err }
    );
  }

  await recordAudit({
    env: def.name,
    operator: "portalops",
    command: "service scale",
    args: { service, desired: count },
  });
  return { service, desired: count };
}
