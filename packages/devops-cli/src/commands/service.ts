/**
 * `portalops service scale` (#852): the API service's task count, set through
 * the backend stack's DesiredCount (never ECS UpdateService, so the stack
 * stays the record of what should run). It is the maintenance-window lever
 * of a Redis replacement: the workers run in the API process, so scaling to
 * zero is what stops both enqueuing and processing. The stack update's own
 * wait covers the service reaching its new count: CloudFormation completes
 * an ECS service update only once the service is stable.
 */

import {
  assertOperationAllowed,
  recordAudit,
  EnvConfirmationRequiredError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import {
  requireDeployed,
  serviceName,
  updateBackendParams,
} from "../stacks.js";
import { countActiveJobs } from "./jobs.js";
import type { MutateOptions } from "./vars.js";

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
): Promise<{ service: string; desired: number; changed: boolean }> {
  requireDeployed(def);
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

  const { changed } = await updateBackendParams(def, {
    DesiredCount: String(count),
  });

  const service = serviceName(def);
  if (changed) {
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "service scale",
      args: { service, desired: count },
    });
  }
  return { service, desired: count, changed };
}
