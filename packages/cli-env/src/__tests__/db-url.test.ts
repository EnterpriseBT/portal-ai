/**
 * composeDatabaseUrl (#500) — the ONE place a connection string is composed
 * from the RDS-managed master secret. Always current: consumers (the app's
 * CLI paths via connection.db(), `portalops db url`) never read the stored
 * `database-url` copy for credentials again. Shape pins migrated verbatim
 * from `devops-cli`'s dbUrl tests (#384) — same behavior, new home.
 */

import { jest } from "@jest/globals";

const getSecretByArnMock =
  jest.fn<(def: unknown, arn: string) => Promise<string>>();
jest.unstable_mockModule("../aws.js", () => ({
  getSecretByArn: getSecretByArnMock,
}));

const resolveExportMock =
  jest.fn<(def: unknown, name: string, hint?: string) => Promise<string>>();
jest.unstable_mockModule("../tunnel.js", () => ({
  resolveExport: resolveExportMock,
}));

const { composeDatabaseUrl } = await import("../db-url.js");
const { EnvInfraError } = await import("../errors.js");
const { BUILTIN_ENVIRONMENTS } = await import("../registry.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const prod = BUILTIN_ENVIRONMENTS["prod"];

const stackExports = (
  endpoint = "portalai-dev.abc.us-east-1.rds.amazonaws.com",
  port = "5432",
  arn = "arn:aws:secretsmanager:us-east-1:1:secret:rds!db-x"
) => {
  resolveExportMock
    .mockResolvedValueOnce(endpoint)
    .mockResolvedValueOnce(port)
    .mockResolvedValueOnce(arn);
};

const master = (password: string, username = "portalai") =>
  getSecretByArnMock.mockResolvedValue(JSON.stringify({ username, password }));

beforeEach(() => {
  getSecretByArnMock.mockReset();
  resolveExportMock.mockReset();
});

it("composes the default shape — pinned against dev's live value (case 11)", async () => {
  stackExports();
  master("s3cret");
  const out = await composeDatabaseUrl(appDev);
  expect(out.url).toBe(
    "postgresql://portalai:s3cret@portalai-dev.abc.us-east-1.rds.amazonaws.com:5432/portal_ai?sslmode=require"
  );
  expect(out.endpoint).toBe("portalai-dev.abc.us-east-1.rds.amazonaws.com");
  expect(out.port).toBe(5432);
  expect(out.dbName).toBe("portal_ai");
});

it("percent-encodes both credential halves — a hostile password round-trips (case 11)", async () => {
  stackExports();
  master("p@ss:w/rd#?", "user@corp");
  const out = await composeDatabaseUrl(appDev);
  const parsed = new URL(out.url);
  expect(decodeURIComponent(parsed.password)).toBe("p@ss:w/rd#?");
  expect(decodeURIComponent(parsed.username)).toBe("user@corp");
  expect(parsed.hostname).toBe("portalai-dev.abc.us-east-1.rds.amazonaws.com");
});

it("reads the three exports for the env's AWS name (migrated pin)", async () => {
  stackExports();
  master("p");
  await composeDatabaseUrl(prod);
  const asked = resolveExportMock.mock.calls.map((c) => c[1]);
  expect(asked).toEqual([
    "prod-DbEndpoint",
    "prod-DbPort",
    "prod-DbMasterSecretArn",
  ]);
});

it("honors dbName and sslMode overrides (migrated pin)", async () => {
  stackExports();
  master("p");
  const out = await composeDatabaseUrl(appDev, {
    dbName: "postgres",
    sslMode: "disable",
  });
  expect(out.url).toContain("/postgres?sslmode=disable");
  expect(out.dbName).toBe("postgres");
});

it("redactedUrl never carries the password", async () => {
  stackExports();
  master("s3cret");
  const out = await composeDatabaseUrl(appDev);
  expect(out.redactedUrl).toContain(":***@");
  expect(out.redactedUrl).not.toContain("s3cret");
});

it("a non-JSON master secret is an actionable EnvInfraError (case 12)", async () => {
  stackExports();
  getSecretByArnMock.mockResolvedValue("not-json");
  const failing = composeDatabaseUrl(appDev);
  await expect(failing).rejects.toThrow(
    /is not JSON — cannot compose a connection string/
  );
  await expect(failing).rejects.toBeInstanceOf(EnvInfraError);
});

it("a master secret missing username/password is an actionable EnvInfraError (case 12)", async () => {
  stackExports();
  getSecretByArnMock.mockResolvedValue(JSON.stringify({ username: "x" }));
  await expect(composeDatabaseUrl(appDev)).rejects.toThrow(
    /missing username\/password/
  );
});
