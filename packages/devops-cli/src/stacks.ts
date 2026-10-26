/**
 * The deployed backend stack and the API's ECS service (#852): the helpers
 * `service scale` and `cache status` share. A parameter change is an
 * UpdateStack on the deployed template, waited on through the operation's
 * own stack events (#864).
 */

import { randomUUID } from "node:crypto";

import {
  CloudFormationClient,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { DescribeServicesCommand, ECSClient } from "@aws-sdk/client-ecs";

import {
  clusterName,
  EnvInfraError,
  EnvNotConfiguredError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { apiServiceName } from "./ecs.js";

// A backend update waits for the ECS service to stabilize; allow an hour.
const STACK_WAIT_MAX_SECONDS = 3600;

type AwsEnv = { region: string; envName: string };

export function requireDeployed(def: EnvironmentDefinition): AwsEnv {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `"${def.name}" has no deployed stacks — its stacks and service live in AWS`
    );
  }
  return def.aws;
}

export const backendStackName = (def: EnvironmentDefinition): string =>
  `portalai-${requireDeployed(def).envName}-backend`;

export const serviceName = (def: EnvironmentDefinition): string => {
  requireDeployed(def);
  return apiServiceName(def);
};

const cfn = (def: EnvironmentDefinition) =>
  new CloudFormationClient({ region: requireDeployed(def).region });

/** The deployed backend stack's current parameter values. */
async function readBackendParams(
  def: EnvironmentDefinition
): Promise<Record<string, string>> {
  const name = backendStackName(def);
  const out = await cfn(def).send(
    new DescribeStacksCommand({ StackName: name })
  );
  const stack = out.Stacks?.[0];
  if (!stack) throw new EnvInfraError(`Stack ${name} not found`);
  return Object.fromEntries(
    (stack.Parameters ?? []).map((p) => [
      p.ParameterKey ?? "",
      p.ParameterValue ?? "",
    ])
  );
}

/** Poll interval for stack operations; tests swap `sleep` out. */
export const stackTiming = {
  pollMs: 15_000,
  sleep: (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** A token that tags one stack operation's events (#864). */
const operationToken = () => `portalops-${randomUUID()}`;

const STACK_FAILED = new Set([
  "UPDATE_ROLLBACK_COMPLETE",
  "UPDATE_ROLLBACK_FAILED",
  "UPDATE_FAILED",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_FAILED",
]);

/**
 * Wait for the stack operation started with `token` to finish (#864).
 *
 * It reads the stack's events for the stack-level event that carries this
 * operation's ClientRequestToken, so neither another operation (a deploy
 * that lands meanwhile) nor the stack's previous status can be taken for
 * this one. A missing stack fails at once. Succeeds only on UPDATE_COMPLETE.
 */
export async function waitForStackOperation(
  client: CloudFormationClient,
  stack: string,
  token: string
): Promise<void> {
  const deadline = Date.now() + STACK_WAIT_MAX_SECONDS * 1000;
  for (;;) {
    let events;
    try {
      events =
        (
          await client.send(
            new DescribeStackEventsCommand({ StackName: stack })
          )
        ).StackEvents ?? [];
    } catch (err) {
      throw new EnvInfraError(
        `Reading ${stack}'s events failed: ${(err as Error).message}`,
        { cause: err }
      );
    }
    const mine = events.find(
      (e) =>
        e.ClientRequestToken === token &&
        e.LogicalResourceId === stack &&
        e.ResourceType === "AWS::CloudFormation::Stack"
    );
    const status = mine?.ResourceStatus ?? "";
    if (status === "UPDATE_COMPLETE") return;
    if (STACK_FAILED.has(status)) {
      throw new EnvInfraError(
        `${stack} ended ${status}${mine?.ResourceStatusReason ? `: ${mine.ResourceStatusReason}` : ""}`
      );
    }
    if (Date.now() > deadline) {
      throw new EnvInfraError(
        `${stack}: ${status ? `still ${status}` : "no sign of the update"} after ${STACK_WAIT_MAX_SECONDS}s`
      );
    }
    await stackTiming.sleep(stackTiming.pollMs);
  }
}

/**
 * UpdateStack on the deployed backend template, changing only `overrides`.
 * Every other parameter is sent as UsePreviousValue, read from the stack
 * itself rather than a hard-coded list, so a parameter added later can't be
 * silently reset to its default.
 */
export async function updateBackendParams(
  def: EnvironmentDefinition,
  overrides: Record<string, string>
): Promise<{ changed: boolean }> {
  const name = backendStackName(def);
  const current = await readBackendParams(def);
  for (const key of Object.keys(overrides)) {
    if (!(key in current)) {
      throw new EnvInfraError(
        `${name}'s deployed template has no ${key} parameter`
      );
    }
  }

  const client = cfn(def);
  const token = operationToken();
  try {
    await client.send(
      new UpdateStackCommand({
        StackName: name,
        ClientRequestToken: token,
        UsePreviousTemplate: true,
        Parameters: Object.keys(current).map((key) =>
          key in overrides
            ? { ParameterKey: key, ParameterValue: overrides[key] }
            : { ParameterKey: key, UsePreviousValue: true }
        ),
        // backend.yml names its IAM roles.
        Capabilities: ["CAPABILITY_NAMED_IAM"],
      })
    );
  } catch (err) {
    if (/No updates are to be performed/.test((err as Error).message ?? "")) {
      return { changed: false };
    }
    throw new EnvInfraError(
      `Updating ${name} failed: ${(err as Error).message}`,
      { cause: err }
    );
  }

  await waitForStackOperation(client, name, token);
  return { changed: true };
}

export async function readService(
  def: EnvironmentDefinition
): Promise<{ desired: number; running: number }> {
  const aws = requireDeployed(def);
  const out = await new ECSClient({ region: aws.region }).send(
    new DescribeServicesCommand({
      cluster: clusterName(def),
      services: [serviceName(def)],
    })
  );
  const svc = out.services?.[0];
  if (!svc) {
    throw new EnvInfraError(`Service ${serviceName(def)} not found`);
  }
  return { desired: svc.desiredCount ?? 0, running: svc.runningCount ?? 0 };
}
