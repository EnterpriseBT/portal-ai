/**
 * ElastiCache encryption guards (#852, #872).
 *
 * The encrypted replication group is the only cache: #872 removed the
 * plaintext one and the cutover parameters that chose between them. These
 * pin the shape the site's /security/ claims rest on: every cache encrypted
 * at rest and in transit and refusing plaintext, with no condition that could
 * leave one out, and the API reaching it over rediss:// with no other branch.
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

describe("cache.yml — every cache is encrypted", () => {
  const caches = Object.entries(cache.Resources).filter(([, r]) =>
    r.Type.startsWith("AWS::ElastiCache::")
  );
  const groups = caches.filter(
    ([, r]) => r.Type !== "AWS::ElastiCache::SubnetGroup"
  );

  it("declares exactly one cache, a replication group", () => {
    // A CacheCluster can't encrypt at rest, so none may come back.
    expect(groups.map(([id, r]) => [id, r.Type])).toEqual([
      ["EncryptedRedisReplicationGroup", "AWS::ElastiCache::ReplicationGroup"],
    ]);
  });

  it.each(groups.map(([id]) => id))(
    "%s encrypts at rest and in transit, refuses plaintext, and is unconditional",
    (id) => {
      const group = cache.Resources[id]!;
      expect(group.Condition).toBeUndefined();
      expect(group.Properties).toMatchObject({
        AtRestEncryptionEnabled: true,
        TransitEncryptionEnabled: true,
        TransitEncryptionMode: "required",
      });
    }
  );

  it("keeps the group's name, so the endpoint the backend imports is stable", () => {
    expect(
      cache.Resources.EncryptedRedisReplicationGroup!.Properties
        .ReplicationGroupId
    ).toBe("portalai-${Environment}-tls");
  });

  it("has no cutover parameters or conditions left", () => {
    expect(Object.keys(cache.Parameters)).not.toContain("RedisCutoverPhase");
    expect(Object.keys(cache.Conditions)).toEqual(["IsReplicated"]);
  });
});

describe("cache.yml — exports", () => {
  it("exports only the TLS endpoint and port, unconditionally", () => {
    for (const [key, name] of [
      ["RedisTlsEndpoint", "${Environment}-RedisTlsEndpoint"],
      ["RedisTlsPort", "${Environment}-RedisTlsPort"],
    ]) {
      expect(cache.Outputs[key]!.Condition).toBeUndefined();
      expect(cache.Outputs[key]!.Export?.Name).toBe(name);
    }
    expect(cache.Outputs.RedisEndpoint).toBeUndefined();
    expect(cache.Outputs.RedisPort).toBeUndefined();
  });
});

describe("backend.yml — REDIS_URL is always rediss://", () => {
  const env = (
    backend.Resources.TaskDefinition!.Properties.ContainerDefinitions as Array<{
      Environment: Array<{ Name: string; Value: unknown }>;
    }>
  )[0]!.Environment;
  const redisUrl = env.find((e) => e.Name === "REDIS_URL")!.Value;

  it("builds rediss:// from the TLS exports, with no other branch", () => {
    const [format, vars] = redisUrl as [string, Record<string, unknown>];
    expect(format).toBe("rediss://${Endpoint}:${Port}");
    expect(JSON.stringify(vars)).toContain("RedisTlsEndpoint");
    expect(JSON.stringify(vars)).toContain("RedisTlsPort");
  });

  it("has no endpoint-source parameter or condition", () => {
    expect(Object.keys(backend.Parameters)).not.toContain(
      "RedisEndpointSource"
    );
    expect(Object.keys(backend.Conditions)).not.toContain("UseEncryptedRedis");
  });
});

describe("no workflow passes a removed cutover parameter (#872)", () => {
  // `aws cloudformation deploy --parameter-overrides` silently drops a
  // parameter the template doesn't declare, so a workflow passing either
  // would deploy cleanly and the value would do nothing.
  const dir = path.join(ROOT, ".github/workflows");
  const workflows = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  it.each(workflows)("%s names neither parameter", (file) => {
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    expect(body).not.toMatch(/RedisCutoverPhase|RedisEndpointSource/);
  });
});
