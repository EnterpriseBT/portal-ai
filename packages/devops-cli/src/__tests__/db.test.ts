import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvConfirmationRequiredError,
  EnvInfraError,
  type MockEnvDef,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

// db.ts composes reset + ecs — mock both (each has its own suite).
const runResetMock = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../reset.js", () => ({ runReset: runResetMock }));
const runSeedTaskMock = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../ecs.js", () => ({ runSeedTask: runSeedTaskMock }));

const { dbTunnel, dbPsql, dbSeed, dbResetSeed } =
  await import("../commands/db.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
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
    expect(out).toEqual({ taskArn: "arn", exitCode: 0 });
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "db seed" })
    );
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
});
