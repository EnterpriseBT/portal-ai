/**
 * `portalops cache …` (#852): the operator levers of the ElastiCache
 * encryption cutover.
 *
 * The encrypted cache sits beside the plaintext one in `cache.yml`, behind
 * `RedisCutoverPhase` (legacy → both → encrypted), and `backend.yml` points
 * REDIS_URL at one of them through `RedisEndpointSource`. The deploy
 * workflows never pass either parameter, so these commands are the only
 * thing that moves them. Every phase or switch is an UpdateStack on the
 * DEPLOYED template with every other parameter at its previous value: a
 * cutover step never redeploys code. The one exception is
 * `refresh-template` (#861), which applies main's cache.yml when the deploy
 * skipped it, previewed and from a clean checkout. The sequence is in
 * docs/REDIS_ENCRYPTION_CUTOVER.runbook.md.
 */

import {
  CloudFormationClient,
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilChangeSetCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import {
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from "@aws-sdk/client-elasticache";
import { DescribeServicesCommand, ECSClient } from "@aws-sdk/client-ecs";

import {
  assertOperationAllowed,
  clusterName,
  recordAudit,
  EnvInfraError,
  EnvNotConfiguredError,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { parseDocument } from "yaml";

import { apiServiceName } from "../ecs.js";
import { readRepoTemplate, repoGitState } from "../templates.js";
import type { MutateOptions } from "./vars.js";

/** A cutover step taken out of order (exit 9, the conflict family). */
export class CacheCutoverConflictError extends Error {
  readonly code = "CACHE_CUTOVER_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "CacheCutoverConflictError";
  }
}

export type CutoverPhase = "legacy" | "both" | "encrypted";
export type EndpointSource = "legacy" | "encrypted";

// An ElastiCache creation or deletion takes 10–20 minutes.
const STACK_WAIT_MAX_SECONDS = 3600;

type AwsEnv = { region: string; envName: string };

export function requireDeployed(def: EnvironmentDefinition): AwsEnv {
  if (!def.aws) {
    throw new EnvNotConfiguredError(
      `"${def.name}" has no deployed stacks — the cache cutover applies to AWS environments only`
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
      throw new CacheCutoverConflictError(
        `${name}'s deployed template has no ${key} parameter. If its release is deployed, the deploy ` +
          `skipped a template with no resource changes (#861): run \`portalops cache refresh-template ` +
          `--env ${def.name}\` from a clean checkout of main, then retry.`
      );
    }
  }

  const client = cfn(def);
  try {
    await client.send(
      new UpdateStackCommand({
        StackName: name,
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

  try {
    await waitUntilStackUpdateComplete(
      { client, maxWaitTime: STACK_WAIT_MAX_SECONDS },
      { StackName: name }
    );
  } catch (err) {
    throw new EnvInfraError(
      `${name} did not reach UPDATE_COMPLETE — check its events in the CloudFormation console (${(err as Error).message})`,
      { cause: err }
    );
  }
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
  // Dev's legacy cache is a CacheCluster, prod's a replication group.
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
  phase: string;
  endpointSource: string;
  caches: CacheInfo[];
  service: { desired: number; running: number };
}

/** Read-only: where the cutover stands. A stack whose template predates #852
 *  has no phase parameters and reads as `legacy`. */
export async function cacheStatus(
  def: EnvironmentDefinition
): Promise<CacheStatus> {
  requireDeployed(def);
  const [cacheParams, backendParams, caches, service] = await Promise.all([
    readStackParams(def, "cache"),
    readStackParams(def, "backend"),
    describeCaches(def),
    readService(def),
  ]);
  return {
    phase: cacheParams.RedisCutoverPhase ?? "legacy",
    endpointSource: backendParams.RedisEndpointSource ?? "legacy",
    caches,
    service,
  };
}

/**
 * Move `cache.yml`'s phase. `both` creates the encrypted cache; `encrypted`
 * removes the legacy one, so it is destructive (refused on prod, where the
 * legacy cache goes with the cleanup release instead). A phase may only drop
 * the cache the backend isn't using.
 */
export async function cachePhase(
  def: EnvironmentDefinition,
  phase: CutoverPhase,
  opts: MutateOptions
): Promise<{ stack: string; phase: CutoverPhase; changed: boolean }> {
  requireDeployed(def);
  assertOperationAllowed(def, {
    destructive: phase === "encrypted",
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

  const source =
    (await readStackParams(def, "backend")).RedisEndpointSource ?? "legacy";
  if (phase === "encrypted" && source !== "encrypted") {
    throw new CacheCutoverConflictError(
      "The backend still uses the legacy cache — run `portalops cache switch encrypted` before retiring it"
    );
  }
  if (phase === "legacy" && source !== "legacy") {
    throw new CacheCutoverConflictError(
      "The backend uses the encrypted cache — run `portalops cache switch legacy` before removing it"
    );
  }

  const { changed } = await updateStackParams(def, "cache", {
    RedisCutoverPhase: phase,
  });
  const stack = stackName(def, "cache");
  if (changed) {
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "cache phase",
      args: { stack, phase },
    });
  }
  return { stack, phase, changed };
}

/**
 * Point `backend.yml`'s REDIS_URL at the other cache. Only with both caches
 * present and the service already at zero (scaled down after a drain), and
 * it holds DesiredCount at 0: the tasks start against the new cache only
 * after `jobs redispatch` has re-queued the drained rows.
 */
export async function cacheSwitch(
  def: EnvironmentDefinition,
  to: EndpointSource,
  opts: MutateOptions
): Promise<{
  stack: string;
  endpointSource: EndpointSource;
  changed: boolean;
}> {
  requireDeployed(def);
  assertOperationAllowed(def, {
    destructive: false,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

  const phase =
    (await readStackParams(def, "cache")).RedisCutoverPhase ?? "legacy";
  if (phase !== "both") {
    throw new CacheCutoverConflictError(
      `Both caches must exist to switch (phase is ${phase}) — run \`portalops cache phase both\` first`
    );
  }
  const service = await readService(def);
  if (service.desired !== 0 || service.running !== 0) {
    throw new CacheCutoverConflictError(
      `${serviceName(def)} is running (${service.running} of ${service.desired} tasks) — drain, then \`portalops service scale 0\` first`
    );
  }

  const { changed } = await updateStackParams(def, "backend", {
    RedisEndpointSource: to,
    DesiredCount: "0",
  });
  const stack = stackName(def, "backend");
  if (changed) {
    await recordAudit({
      env: def.name,
      operator: "portalops",
      command: "cache switch",
      args: { stack, endpointSource: to },
    });
  }
  return { stack, endpointSource: to, changed };
}

/** UpdateStack's inline TemplateBody limit; larger needs an S3 URL. */
const TEMPLATE_BODY_MAX_BYTES = 51_200;

/** A template's declared parameters and whether each has a default.
 *  CloudFormation's short tags (!Ref, !Sub) are kept, not resolved. */
function declaredParameters(
  body: string
): Map<string, { hasDefault: boolean }> {
  const doc = parseDocument(body, { logLevel: "silent" });
  if (doc.errors.length) {
    throw new EnvInfraError(
      `template does not parse: ${doc.errors[0]!.message}`
    );
  }
  const params =
    (
      doc.toJS({ maxAliasCount: -1 }) as {
        Parameters?: Record<string, { Default?: unknown }>;
      }
    ).Parameters ?? {};
  return new Map(
    Object.entries(params).map(([key, p]) => [
      key,
      { hasDefault: p?.Default !== undefined },
    ])
  );
}

export interface ResourceChange {
  logicalId: string;
  action: string;
  replacement: string | null;
}

export interface RefreshTemplateDeps {
  readTemplate: typeof readRepoTemplate;
  gitState: typeof repoGitState;
}

/**
 * Apply main's `cache.yml` to the cache stack, parameters unchanged (#861).
 *
 * The deploy workflows skip a template whose only changes are parameters,
 * conditions and outputs (no resource change), so the deployed cache
 * template can predate a parameter its release added. This applies the
 * template explicitly, and only when it is exactly main:
 * - the checkout must be clean for the template and at `origin/main`;
 * - every parameter the template declares and the stack has keeps its
 *   previous value; a new one must have a default;
 * - a change set previews it first, and any resource removal or replacement
 *   counts as destructive (refused on prod);
 * - the audit line records the template and the commit.
 * The cutover commands stay parameter-only; this is the one place a template
 * is applied.
 */
export async function cacheRefreshTemplate(
  def: EnvironmentDefinition,
  opts: MutateOptions & { dryRun?: boolean },
  deps: RefreshTemplateDeps = {
    readTemplate: readRepoTemplate,
    gitState: repoGitState,
  }
): Promise<{
  stack: string;
  template: string;
  commit: string;
  resourceChanges: ResourceChange[];
  dryRun: boolean;
  changed: boolean;
}> {
  requireDeployed(def);
  const stack = stackName(def, "cache");
  const template = deps.readTemplate("cache");
  if (!template) {
    throw new CacheCutoverConflictError(
      "No repo checkout found to read infra/cloudformation/cache.yml from: run portalops from a checkout of main"
    );
  }
  const git = deps.gitState(template.path);
  if (git.dirty) {
    throw new CacheCutoverConflictError(
      `${template.path} has uncommitted changes: refresh only from a clean checkout of origin/main`
    );
  }
  if (!git.main || git.head !== git.main) {
    throw new CacheCutoverConflictError(
      `the checkout is at ${git.head.slice(0, 8)}, not origin/main${git.main ? ` (${git.main.slice(0, 8)})` : ""}: ` +
        `\`git checkout main && git pull\` first`
    );
  }
  if (Buffer.byteLength(template.body) > TEMPLATE_BODY_MAX_BYTES) {
    throw new EnvInfraError(
      `${template.path} is over UpdateStack's ${TEMPLATE_BODY_MAX_BYTES}-byte TemplateBody limit`
    );
  }

  const declared = declaredParameters(template.body);
  const current = await readStackParams(def, "cache");
  const unsupplied = [...declared]
    .filter(([key, p]) => !(key in current) && !p.hasDefault)
    .map(([k]) => k);
  if (unsupplied.length) {
    throw new CacheCutoverConflictError(
      `the template adds ${unsupplied.join(", ")} with no default, which the stack can't supply: deploy it through the workflow instead`
    );
  }
  const parameters = [...declared.keys()]
    .filter((key) => key in current)
    .map((key) => ({ ParameterKey: key, UsePreviousValue: true }));

  // Preview. A change set with no resource changes ends FAILED ("didn't
  // contain changes"): that is the template-only case this exists for.
  const client = cfn(def);
  const changeSetName = `portalops-refresh-${Date.now()}`;
  await client.send(
    new CreateChangeSetCommand({
      StackName: stack,
      ChangeSetName: changeSetName,
      TemplateBody: template.body,
      Parameters: parameters,
    })
  );
  let resourceChanges: ResourceChange[] = [];
  try {
    try {
      await waitUntilChangeSetCreateComplete(
        { client, maxWaitTime: 300 },
        { StackName: stack, ChangeSetName: changeSetName }
      );
    } catch {
      // read the status below either way
    }
    const described = await client.send(
      new DescribeChangeSetCommand({
        StackName: stack,
        ChangeSetName: changeSetName,
      })
    );
    if (described.Status === "FAILED") {
      if (!/didn't contain changes/.test(described.StatusReason ?? "")) {
        throw new EnvInfraError(
          `Previewing ${stack} failed: ${described.StatusReason}`
        );
      }
    } else {
      resourceChanges = (described.Changes ?? []).map((c) => ({
        logicalId: c.ResourceChange?.LogicalResourceId ?? "?",
        action: c.ResourceChange?.Action ?? "?",
        replacement: c.ResourceChange?.Replacement ?? null,
      }));
    }
  } finally {
    await client
      .send(
        new DeleteChangeSetCommand({
          StackName: stack,
          ChangeSetName: changeSetName,
        })
      )
      .catch(() => undefined);
  }

  const result = {
    stack,
    template: template.path,
    commit: git.head,
    resourceChanges,
  };
  if (opts.dryRun) return { ...result, dryRun: true, changed: false };

  const destructive = resourceChanges.some(
    (c) =>
      c.action === "Remove" ||
      c.replacement === "True" ||
      c.replacement === "Conditional"
  );
  assertOperationAllowed(def, {
    destructive,
    confirmed: !!opts.yes,
    prodConfirmed: !!opts.confirmProd,
  });

  try {
    await client.send(
      new UpdateStackCommand({
        StackName: stack,
        TemplateBody: template.body,
        Parameters: parameters,
      })
    );
  } catch (err) {
    if (/No updates are to be performed/.test((err as Error).message ?? "")) {
      return { ...result, dryRun: false, changed: false };
    }
    throw new EnvInfraError(
      `Updating ${stack} failed: ${(err as Error).message}`,
      { cause: err }
    );
  }
  try {
    await waitUntilStackUpdateComplete(
      { client, maxWaitTime: STACK_WAIT_MAX_SECONDS },
      { StackName: stack }
    );
  } catch (err) {
    throw new EnvInfraError(
      `${stack} did not reach UPDATE_COMPLETE — check its events in the CloudFormation console (${(err as Error).message})`,
      { cause: err }
    );
  }
  await recordAudit({
    env: def.name,
    operator: "portalops",
    command: "cache refresh-template",
    args: {
      stack,
      template: template.path,
      commit: git.head,
      resourceChanges: resourceChanges.length,
    },
  });
  return { ...result, dryRun: false, changed: true };
}
