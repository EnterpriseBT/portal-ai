/**
 * `runApiScript` (#295) — the contract both CLIs depend on: the app's own
 * npm script, run against the env's database, with the connection disposed
 * whatever happens.
 */

import { jest } from "@jest/globals";

const disposeMock = jest.fn<() => Promise<void>>();
const dbMock = jest.fn<() => Promise<{ connectionString: string }>>();
const resolveEnvConnectionMock =
  jest.fn<(name: string) => Promise<Record<string, unknown>>>();

jest.unstable_mockModule("../connection.js", () => ({
  resolveEnvConnection: resolveEnvConnectionMock,
}));

const { runApiScript } = await import("../spawn.js");
const { EnvInfraError } = await import("../errors.js");
const { BUILTIN_ENVIRONMENTS } = await import("../registry.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

type SpawnResult = { code: number; stdout: string; stderr: string };

const spawnerCalls: Array<{ args: string[]; env: Record<string, string> }> = [];
let nextResult: SpawnResult = { code: 0, stdout: "", stderr: "" };
const spawner = async (args: string[], env: Record<string, string>) => {
  spawnerCalls.push({ args, env });
  return nextResult;
};

beforeEach(() => {
  spawnerCalls.length = 0;
  nextResult = { code: 0, stdout: "", stderr: "" };
  disposeMock.mockReset().mockResolvedValue(undefined);
  dbMock
    .mockReset()
    .mockResolvedValue({ connectionString: "postgresql://u:p@host:5432/db" });
  resolveEnvConnectionMock.mockReset().mockResolvedValue({
    env: "app-dev",
    db: dbMock,
    dispose: disposeMock,
  });
});

describe("runApiScript", () => {
  it("runs the script in the @portalai/api workspace with args after --", async () => {
    await runApiScript(
      appDev,
      "db:create-org",
      ["--name", "Acme"],
      spawner as never
    );

    expect(spawnerCalls[0].args).toEqual([
      "run",
      "--workspace",
      "@portalai/api",
      "db:create-org",
      "--",
      "--name",
      "Acme",
    ]);
  });

  it("passes no trailing args when the script takes none", async () => {
    await runApiScript(appDev, "db:seed", [], spawner as never);

    expect(spawnerCalls[0].args).toEqual([
      "run",
      "--workspace",
      "@portalai/api",
      "db:seed",
      "--",
    ]);
  });

  it("injects DATABASE_URL from the env connection", async () => {
    await runApiScript(appDev, "db:seed", [], spawner as never);

    expect(spawnerCalls[0].env.DATABASE_URL).toBe(
      "postgresql://u:p@host:5432/db"
    );
  });

  it("returns the script's stdout", async () => {
    nextResult = { code: 0, stdout: '{"organizationId":"o-1"}\n', stderr: "" };

    await expect(
      runApiScript(appDev, "db:create-org", [], spawner as never)
    ).resolves.toBe('{"organizationId":"o-1"}\n');
  });

  it("throws EnvInfraError naming the script and exit code on failure", async () => {
    nextResult = { code: 1, stdout: "", stderr: "boom\n" };

    const p = runApiScript(appDev, "db:seed", [], spawner as never);
    await expect(p).rejects.toBeInstanceOf(EnvInfraError);
    await expect(p).rejects.toThrow(/db:seed failed \(exit 1\): boom/);
  });

  it("falls back to stdout when the failure wrote nothing to stderr", async () => {
    nextResult = { code: 2, stdout: "usage: …\n", stderr: "" };

    await expect(
      runApiScript(appDev, "db:seed", [], spawner as never)
    ).rejects.toThrow(/db:seed failed \(exit 2\): usage: …/);
  });

  it("disposes the connection on success AND on failure", async () => {
    await runApiScript(appDev, "db:seed", [], spawner as never);
    expect(disposeMock).toHaveBeenCalledTimes(1);

    nextResult = { code: 1, stdout: "", stderr: "boom" };
    await expect(
      runApiScript(appDev, "db:seed", [], spawner as never)
    ).rejects.toThrow();
    expect(disposeMock).toHaveBeenCalledTimes(2);
  });

  it("disposes the connection when resolving the database itself throws", async () => {
    dbMock.mockRejectedValue(new Error("tunnel down"));

    await expect(
      runApiScript(appDev, "db:seed", [], spawner as never)
    ).rejects.toThrow("tunnel down");
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(spawnerCalls).toHaveLength(0);
  });
});
