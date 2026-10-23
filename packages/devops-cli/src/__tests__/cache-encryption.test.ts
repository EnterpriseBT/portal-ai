/**
 * ElastiCache encryption guards (#852).
 *
 * The encrypted cache is introduced beside the plaintext one and moved
 * through operator-run phases (`portalops cache phase|switch`), so the
 * template carries both for a while. These pin the parts whose loss would be
 * silent: the encryption flags themselves, the conditions that keep each
 * export alive exactly while something can import it, and the `legacy`
 * defaults that make merging this a no-op for every environment.
 *
 * `yaml` keeps CloudFormation's short tags (!If, !Sub, …) as plain values, so
 * `!If [Cond, A, B]` reads back as `[Cond, A, B]`.
 */

import fs from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "infra/cloudformation/cache.yml")))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repo root not found from " + process.cwd());
}

const ROOT = repoRoot();

type Template = {
  Parameters: Record<string, { Default?: unknown; AllowedValues?: unknown }>;
  Conditions: Record<string, unknown>;
  Resources: Record<
    string,
    { Type: string; Condition?: string; Properties: Record<string, unknown> }
  >;
  Outputs: Record<
    string,
    { Condition?: string; Value: unknown; Export?: { Name: unknown } }
  >;
};

function load(file: string): Template {
  const doc = parseDocument(
    fs.readFileSync(path.join(ROOT, "infra/cloudformation", file), "utf8"),
    { logLevel: "silent" }
  );
  expect(doc.errors).toHaveLength(0);
  return doc.toJS({ maxAliasCount: -1 }) as Template;
}

const cache = load("cache.yml");
const backend = load("backend.yml");

describe("cache.yml — the encrypted replication group", () => {
  const group = cache.Resources.EncryptedRedisReplicationGroup;

  it("encrypts at rest and in transit, and refuses plaintext", () => {
    expect(group.Type).toBe("AWS::ElastiCache::ReplicationGroup");
    expect(group.Properties).toMatchObject({
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true,
      TransitEncryptionMode: "required",
    });
  });

  it("exists only once the phase reaches both/encrypted, under its own name", () => {
    expect(group.Condition).toBe("HasEncrypted");
    expect(group.Properties.ReplicationGroupId).toBe(
      "portalai-${Environment}-tls"
    );
  });
});

describe("cache.yml — phases and exports", () => {
  it("conditions the legacy resources and exports on HasLegacy", () => {
    expect(cache.Resources.RedisCluster.Condition).toBe("LegacySingle");
    expect(cache.Resources.RedisReplicationGroup.Condition).toBe(
      "LegacyReplicated"
    );
    expect(cache.Outputs.RedisEndpoint.Condition).toBe("HasLegacy");
    expect(cache.Outputs.RedisPort.Condition).toBe("HasLegacy");
  });

  it("exports the TLS endpoint and port only while the encrypted group exists", () => {
    for (const [key, name] of [
      ["RedisTlsEndpoint", "${Environment}-RedisTlsEndpoint"],
      ["RedisTlsPort", "${Environment}-RedisTlsPort"],
    ]) {
      expect(cache.Outputs[key].Condition).toBe("HasEncrypted");
      expect(cache.Outputs[key].Export?.Name).toBe(name);
    }
  });
});

describe("merging changes nothing until an operator moves a phase", () => {
  it("defaults both phase parameters to legacy", () => {
    expect(cache.Parameters.RedisCutoverPhase).toMatchObject({
      Default: "legacy",
      AllowedValues: ["legacy", "both", "encrypted"],
    });
    expect(backend.Parameters.RedisEndpointSource).toMatchObject({
      Default: "legacy",
      AllowedValues: ["legacy", "encrypted"],
    });
  });
});

describe("backend.yml — REDIS_URL follows RedisEndpointSource", () => {
  const env = (
    backend.Resources.TaskDefinition.Properties.ContainerDefinitions as Array<{
      Environment: Array<{ Name: string; Value: unknown }>;
    }>
  )[0]!.Environment;
  const redisUrl = env.find((e) => e.Name === "REDIS_URL")!.Value as [
    string,
    [string, Record<string, unknown>],
    [string, Record<string, unknown>],
  ];

  it("builds rediss:// from the TLS exports when encrypted, redis:// from the legacy ones otherwise", () => {
    const [condition, encrypted, legacy] = redisUrl;
    expect(condition).toBe("UseEncryptedRedis");
    expect(encrypted[0]).toBe("rediss://${Endpoint}:${Port}");
    expect(JSON.stringify(encrypted[1])).toContain("RedisTlsEndpoint");
    expect(legacy[0]).toBe("redis://${Endpoint}:${Port}");
    expect(JSON.stringify(legacy[1])).not.toContain("RedisTls");
  });
});

describe("deploys inherit the operator's phase (#852)", () => {
  // `aws cloudformation deploy` keeps an unpassed parameter's current value,
  // the same rule deploy-prod relies on for DesiredCount. A workflow that
  // passed either of these would silently move an environment back (or
  // forward) on its next routine deploy, mid-cutover.
  const dir = path.join(ROOT, ".github/workflows");
  const workflows = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  it.each(workflows)("%s passes neither phase parameter", (file) => {
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    expect(body).not.toMatch(/RedisCutoverPhase|RedisEndpointSource/);
  });
});
