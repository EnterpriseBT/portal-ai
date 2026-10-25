/**
 * `portalops cache status` (#852, #872), and the stack helpers
 * `service scale` shares.
 *
 * Every environment runs one cache: the replication group
 * `portalai-<env>-tls`, encrypted at rest and in transit, refusing
 * plaintext. #872 removed the plaintext cache it replaced and the cutover
 * commands that moved between them. `status` still looks for the plaintext
 * ids too, so a leftover one shows up rather than hiding.
 */

import { randomUUID } from "node:crypto";

import {
  CloudFormationClient,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import {
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from "@aws-sdk/client-elasticache";
import { DescribeServicesCommand, ECSClient } from "@aws-sdk/client-ecs";

import {
  clusterName,
  EnvInfraError,
  EnvNotConfiguredError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { apiServiceName } from "../ecs.js";

// A stack update can replace a cache node, which takes 10–20 minutes.
const STACK_WAIT_MAX_SECONDS = 3600;

type AwsEnv = { region: string; envName: string };

export function requireDeployed(def: EnvironmentDefinition): AwsEnv {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `"${def.name}" has no deployed stacks — its cache and service live in AWS`
    );
  }
  return def.aws;
}

export const stackName = (
  def: EnvironmentDefinition,
  kind: "cache" | "backend"
): string => `portalai-${requireDeployed(def).envName}-${kind}`;

export const serviceName = (def: EnvironmentDefinition): string => {
  requireDeployed(def);
  return apiServiceName(def);
};

const cfn = (def: EnvironmentDefinition) =>
  new CloudFormationClient({ region: requireDeployed(def).region });

/** The deployed stack's current parameter values. */
export async function readStackParams(
  def: EnvironmentDefinition,
  kind: "cache" | "backend"
): Promise<Record<string, string>> {
  const name = stackName(def, kind);
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
 * UpdateStack on the deployed template, changing only `overrides`. Every
 * other parameter is sent as UsePreviousValue, read from the stack itself
 * rather than a hard-coded list, so a parameter added later can't be
 * silently reset to its default. An override the deployed template doesn't
 * declare means the release carrying it isn't deployed yet.
 */
export async function updateStackParams(
  def: EnvironmentDefinition,
  kind: "cache" | "backend",
  overrides: Record<string, string>
): Promise<{ changed: boolean }> {
  const name = stackName(def, kind);
  const current = await readStackParams(def, kind);
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
        // backend.yml names its IAM roles; cache.yml has none, and the
        // capability is only an acknowledgement.
        ...(kind === "backend"
          ? { Capabilities: ["CAPABILITY_NAMED_IAM"] }
          : {}),
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

export interface CacheInfo {
  id: string;
  kind: "cache-cluster" | "replication-group";
  status: string | null;
  atRestEncryption: boolean;
  transitEncryption: boolean;
  transitEncryptionMode: string | null;
}

const NOT_FOUND = new Set([
  "ReplicationGroupNotFoundFault",
  "CacheClusterNotFoundFault",
]);

async function describeCaches(def: EnvironmentDefinition) {
  const aws = requireDeployed(def);
  const client = new ElastiCacheClient({ region: aws.region });
  const legacyId = `portalai-${aws.envName}`;
  const absentOnNotFound = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (NOT_FOUND.has((err as Error).name)) return undefined;
      throw err;
    }
  };

  const caches: CacheInfo[] = [];
  // The plaintext caches #872 removed were a CacheCluster (dev) and a
  // replication group (prod); both ids are checked so a leftover shows.
  const cluster = await absentOnNotFound(
    async () =>
      (
        await client.send(
          new DescribeCacheClustersCommand({ CacheClusterId: legacyId })
        )
      ).CacheClusters?.[0]
  );
  if (cluster) {
    caches.push({
      id: legacyId,
      kind: "cache-cluster",
      status: cluster.CacheClusterStatus ?? null,
      atRestEncryption: !!cluster.AtRestEncryptionEnabled,
      transitEncryption: !!cluster.TransitEncryptionEnabled,
      transitEncryptionMode: cluster.TransitEncryptionMode ?? null,
    });
  }
  for (const id of [legacyId, `${legacyId}-tls`]) {
    const group = await absentOnNotFound(
      async () =>
        (
          await client.send(
            new DescribeReplicationGroupsCommand({ ReplicationGroupId: id })
          )
        ).ReplicationGroups?.[0]
    );
    if (group) {
      caches.push({
        id,
        kind: "replication-group",
        status: group.Status ?? null,
        atRestEncryption: !!group.AtRestEncryptionEnabled,
        transitEncryption: !!group.TransitEncryptionEnabled,
        transitEncryptionMode: group.TransitEncryptionMode ?? null,
      });
    }
  }
  return caches;
}

export interface CacheStatus {
  caches: CacheInfo[];
  service: { desired: number; running: number };
}

/** Read-only: each cache's encryption, and the API service's task counts. */
export async function cacheStatus(
  def: EnvironmentDefinition
): Promise<CacheStatus> {
  requireDeployed(def);
  const [caches, service] = await Promise.all([
    describeCaches(def),
    readService(def),
  ]);
  return { caches, service };
}
