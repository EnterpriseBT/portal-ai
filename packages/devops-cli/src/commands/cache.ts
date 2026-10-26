/**
 * `portalops cache status` (#852, #872).
 *
 * Every environment runs one cache: the replication group
 * `portalai-<env>-tls`, encrypted at rest and in transit, refusing
 * plaintext. #872 removed the plaintext cache it replaced and the cutover
 * commands that moved between them. `status` still looks for the plaintext
 * ids too, so a leftover one shows up rather than hiding.
 */

import {
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from "@aws-sdk/client-elasticache";

import { type EnvironmentDefinition } from "@portalai/cli-env";

import { readService, requireDeployed } from "../stacks.js";

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

  // The plaintext caches #872 removed were a CacheCluster (dev) and a
  // replication group (prod); both ids are checked so a leftover shows.
  // The lookups are independent, so they run together.
  const describeGroup = (id: string) =>
    absentOnNotFound(
      async () =>
        (
          await client.send(
            new DescribeReplicationGroupsCommand({ ReplicationGroupId: id })
          )
        ).ReplicationGroups?.[0]
    );
  const [cluster, legacyGroup, tlsGroup] = await Promise.all([
    absentOnNotFound(
      async () =>
        (
          await client.send(
            new DescribeCacheClustersCommand({ CacheClusterId: legacyId })
          )
        ).CacheClusters?.[0]
    ),
    describeGroup(legacyId),
    describeGroup(`${legacyId}-tls`),
  ]);

  const caches: CacheInfo[] = [];
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
  for (const [id, group] of [
    [legacyId, legacyGroup],
    [`${legacyId}-tls`, tlsGroup],
  ] as const) {
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
