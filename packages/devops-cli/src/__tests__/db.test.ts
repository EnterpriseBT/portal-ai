import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvConfirmationRequiredError,
  EnvInfraError,
  EnvNotConfiguredError,
  type MockEnvDef,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

// db.ts composes reset + ecs — mock both (each has its own suite).
const runResetMock = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../reset.js", () => ({ runReset: runResetMock }));
const runSeedTaskMock = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../ecs.js", () => ({ runSeedTask: runSeedTaskMock }));

const { dbTunnel, dbPsql, dbSeed, dbResetSeed, dbUrl } =
  await import("../commands/db.js");

type RunApiScript = (
  def: MockEnvDef,
  script: string,
  args: string[]
) => Promise<string>;

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const local = BUILTIN_ENVIRONMENTS["local"]; // aws: null — no ECS to seed on
const prodLike: MockEnvDef = {
  name: "prod-like",
  kind: "production",
  apiBaseUrl: "https://x",
  aws: { region: "us-east-1", envName: "prod" },
};

const CONN = "postgresql://u:p@localhost:15432/db";
const connection = () => ({
  env: "app-dev",
  kind: "staging",
  apiBaseUrl: "x",
  db: jest.fn(async () => ({ connectionString: CONN, close: async () => {} })),
  token: async () => "t",
  dispose: jest.fn(async () => {}),
});

beforeEach(() => {
  resetCliEnvMocks();
  runResetMock.mockReset().mockResolvedValue({ dropped: [], truncated: [] });
  runSeedTaskMock
    .mockReset()
    .mockResolvedValue({ taskArn: "arn", exitCode: 0 });
  mocks.resolveEnvConnection.mockResolvedValue(connection());
});

describe("prod connect barrier (tunnel/psql)", () => {
  it("production without --confirm-prod → ENV_CONFIRMATION_REQUIRED, no connection", async () => {
    await expect(dbTunnel(prodLike, {})).rejects.toBeInstanceOf(
      EnvConfirmationRequiredError
    );
    expect(mocks.resolveEnvConnection).not.toHaveBeenCalled();
  });

  it("production with --confirm-prod connects", async () => {
    const conn = connection();
    mocks.resolveEnvConnection.mockResolvedValue(conn);
    const out = await dbTunnel(prodLike, { confirmProd: true });
    expect(out.connectionString).toBe(CONN);
    expect(mocks.resolveEnvConnection).toHaveBeenCalledWith("prod-like");
  });

  it("staging connects without any flag (connect is not a mutation)", async () => {
    const out = await dbTunnel(appDev, {});
    expect(out.connectionString).toBe(CONN);
  });
});

describe("dbPsql", () => {
  it("passes through psql args against the tunneled connection and disposes", async () => {
    const conn = connection();
    mocks.resolveEnvConnection.mockResolvedValue(conn);
    const spawner = jest.fn(async (_cmd: string, _args: string[]) => 0);
    const out = await dbPsql(appDev, { args: ["-tAc", "select 1"] }, spawner);
    expect(spawner).toHaveBeenCalledWith("psql", [CONN, "-tAc", "select 1"]);
    expect(out.exitCode).toBe(0);
    expect(conn.dispose).toHaveBeenCalled();
  });

  it("missing psql binary → ENV_INFRA_ERROR with install guidance", async () => {
    const enoent = Object.assign(new Error("spawn psql ENOENT"), {
      code: "ENOENT",
    });
    const spawner = jest.fn(async () => {
      throw enoent;
    });
    const p = dbPsql(appDev, { args: [] }, spawner);
    await expect(p).rejects.toBeInstanceOf(EnvInfraError);
    await expect(p).rejects.toThrow(/install/i);
  });
});

describe("dbSeed", () => {
  it("guards as a mutation, audits, delegates to runSeedTask", async () => {
    const out = await dbSeed(appDev, { yes: true });
    expect(out).toEqual({ via: "ecs", taskArn: "arn", exitCode: 0 });
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "db seed" })
    );
  });

  // #295: local has no ECS to run a task on. Before the split, `db seed
  // --env local` threw ENV_NOT_CONFIGURED and `db reset-seed --env local`
  // threw it AFTER the wipe.
  it("runs the app's own db:seed script for an env with no ECS", async () => {
    const runScript = jest.fn<RunApiScript>().mockResolvedValue("");
    const out = await dbSeed(local, {}, runScript);

    expect(out).toEqual({ via: "local", script: "db:seed" });
    expect(runScript).toHaveBeenCalledWith(local, "db:seed", []);
    expect(runSeedTaskMock).not.toHaveBeenCalled();
  });

  it("never spawns a local script for a deployed env", async () => {
    const runScript = jest.fn<RunApiScript>().mockResolvedValue("");
    await dbSeed(appDev, { yes: true }, runScript);

    expect(runScript).not.toHaveBeenCalled();
    expect(runSeedTaskMock).toHaveBeenCalled();
  });

  it("records which path ran in the audit line", async () => {
    const runScript = jest.fn<RunApiScript>().mockResolvedValue("");
    await dbSeed(local, {}, runScript);

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "db seed",
        args: { via: "local", script: "db:seed" },
      })
    );
  });

  it("surfaces a failing local seed instead of reporting success", async () => {
    const runScript = jest
      .fn<RunApiScript>()
      .mockRejectedValue(new EnvInfraError("db:seed failed (exit 1): boom"));

    await expect(dbSeed(local, {}, runScript)).rejects.toBeInstanceOf(
      EnvInfraError
    );
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe("dbResetSeed", () => {
  it("resets then seeds — in that order", async () => {
    const order: string[] = [];
    runResetMock.mockImplementation(async () => {
      order.push("reset");
      return { dropped: [], truncated: [] };
    });
    runSeedTaskMock.mockImplementation(async () => {
      order.push("seed");
      return { taskArn: "arn", exitCode: 0 };
    });
    await dbResetSeed(appDev, { yes: true });
    expect(order).toEqual(["reset", "seed"]);
  });

  // The whole point of #295's second defect: local used to wipe, then die.
  it("completes end-to-end for local, seeding through the app's script", async () => {
    const order: string[] = [];
    runResetMock.mockImplementation(async () => {
      order.push("reset");
      return { dropped: ["er__1"], truncated: ["users"] };
    });
    const runScript = jest.fn<RunApiScript>().mockImplementation(async () => {
      order.push("seed");
      return "";
    });

    const out = await dbResetSeed(local, {}, runScript);

    expect(order).toEqual(["reset", "seed"]);
    expect(out.reset).toEqual({ dropped: ["er__1"], truncated: ["users"] });
    expect(out.seed).toEqual({ via: "local", script: "db:seed" });
    expect(runSeedTaskMock).not.toHaveBeenCalled();
  });

  it("a blocked reset never reaches the seed half", async () => {
    runResetMock.mockRejectedValue(
      new EnvConfirmationRequiredError("needs --yes")
    );
    const runScript = jest.fn<RunApiScript>().mockResolvedValue("");

    await expect(dbResetSeed(appDev, {}, runScript)).rejects.toBeInstanceOf(
      EnvConfirmationRequiredError
    );
    expect(runSeedTaskMock).not.toHaveBeenCalled();
    expect(runScript).not.toHaveBeenCalled();
  });
});

// ── db url (#384) ────────────────────────────────────────────────────
//
// Composes the connection string from the database stack's exports and the
// RDS-managed master secret, so the production DB password moves AWS-API to
// AWS-API and is never rendered to a human. RDS creates no application
// database (the template sets no DBName), so `portal_ai` is created by hand —
// which is why --db-name exists as a bootstrap escape hatch.

const prod = BUILTIN_ENVIRONMENTS["prod"];

const stackExports = (
  endpoint = "portalai-dev.abc.us-east-1.rds.amazonaws.com",
  port = "5432",
  arn = "arn:aws:secretsmanager:us-east-1:1:secret:rds!db-x-y2Ev1F"
) => {
  mocks.resolveExport.mockImplementation(async (_def, name) => {
    if (name.endsWith("-DbEndpoint")) return endpoint;
    if (name.endsWith("-DbPort")) return port;
    if (name.endsWith("-DbMasterSecretArn")) return arn;
    throw new EnvInfraError(`unexpected export ${name}`);
  });
};

const master = (password: string, username = "portalai") =>
  mocks.getSecretByArn.mockResolvedValue(
    JSON.stringify({ username, password })
  );

describe("dbUrl (#384)", () => {
  // Composition is only observable unredacted on the write path, so the
  // shape tests below go through it.
  beforeEach(() => mocks.putSecret.mockResolvedValue({ created: false }));

  // Composition is asserted on the value handed to putSecret, never on the
  // return value: dbUrl redacts unconditionally, because `--json` serializes
  // whatever it returns and that published the production password once.
  const written = (): string =>
    mocks.putSecret.mock.calls[0][2] as unknown as string;

  it("composes the default shape — pinned against dev's live value", async () => {
    stackExports();
    master("s3cret");
    await dbUrl(appDev, { write: true, yes: true });
    expect(written()).toBe(
      "postgresql://portalai:s3cret@portalai-dev.abc.us-east-1.rds.amazonaws.com:5432/portal_ai?sslmode=require"
    );
  });

  it("never returns the password, even on the write path", async () => {
    stackExports();
    master("s3cret");
    const out = await dbUrl(appDev, { write: true, yes: true });
    expect(out.connectionString).toContain(":***@");
    expect(JSON.stringify(out)).not.toContain("s3cret");
  });

  it("reads the three exports for the env's AWS name", async () => {
    stackExports();
    master("p");
    await dbUrl(prod, { write: true, yes: true, confirmProd: true });
    const asked = mocks.resolveExport.mock.calls.map((c) => c[1]);
    expect(asked).toEqual([
      "prod-DbEndpoint",
      "prod-DbPort",
      "prod-DbMasterSecretArn",
    ]);
  });

  it("--db-name reaches the maintenance database (the bootstrap escape hatch)", async () => {
    stackExports();
    master("p");
    const out = await dbUrl(appDev, {
      dbName: "postgres",
      write: true,
      yes: true,
    });
    expect(out.connectionString).toContain("/postgres?sslmode=require");
  });

  it("--ssl-mode overrides the query segment", async () => {
    stackExports();
    master("p");
    const out = await dbUrl(appDev, {
      sslMode: "disable",
      write: true,
      yes: true,
    });
    expect(out.connectionString).toContain("?sslmode=disable");
  });

  it("URL-encodes a password containing @ : / # ?", async () => {
    stackExports();
    master("p@ss:w/rd#1?x");
    await dbUrl(appDev, { write: true, yes: true });
    // The bug this pins: an unencoded @ splits the authority and yields a
    // string that parses to the wrong host without erroring.
    expect(written()).toContain(
      "postgresql://portalai:p%40ss%3Aw%2Frd%231%3Fx@"
    );
    expect(new URL(written()).password).toBe("p%40ss%3Aw%2Frd%231%3Fx");
  });

  it("REDACTS the password by default and writes nothing", async () => {
    stackExports();
    master("s3cret");
    const out = await dbUrl(appDev);
    expect(out.connectionString).toBe(
      "postgresql://portalai:***@portalai-dev.abc.us-east-1.rds.amazonaws.com:5432/portal_ai?sslmode=require"
    );
    expect(out.connectionString).not.toContain("s3cret");
    expect(out.written).toBe(false);
    expect(mocks.putSecret).not.toHaveBeenCalled();
    expect(mocks.assertOperationAllowed).not.toHaveBeenCalled();
  });

  it("--write stores it at database-url and reports `created`", async () => {
    stackExports();
    master("s3cret");
    mocks.putSecret.mockResolvedValue({ created: true });
    const out = await dbUrl(appDev, { write: true, yes: true });
    expect(mocks.putSecret).toHaveBeenCalledWith(
      appDev,
      "database-url",
      expect.stringContaining("s3cret")
    );
    expect(out).toMatchObject({ written: true, created: true });
  });

  it("guards BEFORE writing — a rejected guard never calls putSecret", async () => {
    stackExports();
    master("s3cret");
    mocks.assertOperationAllowed.mockImplementation(() => {
      throw new EnvConfirmationRequiredError("needs --confirm-prod");
    });
    await expect(
      dbUrl(prod, { write: true, yes: true })
    ).rejects.toBeInstanceOf(EnvConfirmationRequiredError);
    // Asserting only "it throws" would pass on a compose-then-guard
    // implementation that had already written.
    expect(mocks.putSecret).not.toHaveBeenCalled();
  });

  it("audits the write without the password or the composed string", async () => {
    stackExports();
    master("s3cret");
    mocks.putSecret.mockResolvedValue({ created: false });
    await dbUrl(prod, { write: true, yes: true, confirmProd: true });
    const entry = JSON.stringify(mocks.recordAudit.mock.calls[0][0]);
    expect(entry).toContain("db url");
    expect(entry).toContain("portalai-dev.abc.us-east-1.rds.amazonaws.com");
    expect(entry).not.toContain("s3cret");
    expect(entry).not.toContain("postgresql://");
  });

  it("throws ENV_NOT_CONFIGURED for a local env with no AWS", async () => {
    mocks.resolveExport.mockRejectedValue(
      new EnvNotConfiguredError('"local" has no AWS config')
    );
    await expect(dbUrl(local)).rejects.toBeInstanceOf(EnvNotConfiguredError);
  });
});
