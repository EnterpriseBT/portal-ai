import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvConfirmationRequiredError,
  type MockEnvDef,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

const runRedispatchTaskMock = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../ecs.js", () => ({
  runSeedTask: jest.fn(),
  runUpgradeTask: jest.fn(),
  runRedispatchTask: runRedispatchTaskMock,
}));

const { jobsStatus, jobsRedispatch, countActiveJobs } =
  await import("../commands/jobs.js");

const SUMMARY = {
  acquiredLock: true,
  scanned: 2,
  redispatched: [{ id: "j1", type: "connector_sync", priorStatus: "pending" }],
  present: 1,
  skippedTerminal: 0,
  dryRun: false,
};
const LOG = {
  region: "us-east-1",
  group: "/ecs/portalai-api-dev",
  stream: "api/api/abc",
};

type RunApiScript = (
  def: MockEnvDef,
  script: string,
  args: string[]
) => Promise<string>;

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const local = BUILTIN_ENVIRONMENTS["local"];
const prod = BUILTIN_ENVIRONMENTS["prod"];

const ROWS = [
  { status: "active", type: "connector_sync", count: 2 },
  { status: "pending", type: "connector_sync", count: 3 },
  { status: "pending", type: "revalidation", count: 1 },
];
const read = jest.fn(async () => ROWS);

beforeEach(() => {
  resetCliEnvMocks();
  read.mockClear();
  runRedispatchTaskMock
    .mockReset()
    .mockResolvedValue({ taskArn: "rd-arn", exitCode: 0 });
});

describe("jobsStatus (#852)", () => {
  it("reports non-terminal counts by status and type, with totals", async () => {
    const out = await jobsStatus(appDev, {}, read);
    expect(out).toEqual({
      counts: ROWS,
      byStatus: { active: 2, pending: 4 },
      total: 6,
    });
  });

  it("needs the production barrier to connect to prod", async () => {
    await expect(jobsStatus(prod, {}, read)).rejects.toBeInstanceOf(
      EnvConfirmationRequiredError
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("countActiveJobs sums the active rows", async () => {
    expect(await countActiveJobs(appDev, read)).toBe(2);
  });
});

describe("jobsRedispatch (#852)", () => {
  it("deployed env → ECS one-off, guarded and audited", async () => {
    const runScript = jest.fn<RunApiScript>();
    const out = await jobsRedispatch(appDev, { yes: true }, runScript);

    expect(out).toEqual({
      via: "ecs",
      taskArn: "rd-arn",
      exitCode: 0,
      summary: null,
    });
    expect(runRedispatchTaskMock).toHaveBeenCalledWith(appDev, {
      dryRun: false,
    });
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "jobs redispatch" })
    );
  });

  it("local → the app's jobs:redispatch script", async () => {
    const runScript = jest.fn<RunApiScript>().mockResolvedValue("");
    const out = await jobsRedispatch(local, {}, runScript);

    expect(out).toEqual({
      via: "local",
      script: "jobs:redispatch",
      summary: null,
    });
    expect(runScript).toHaveBeenCalledWith(local, "jobs:redispatch", []);
    expect(runRedispatchTaskMock).not.toHaveBeenCalled();
  });

  it("passes --dry-run through on both routes, and audits only a real run", async () => {
    const runScript = jest.fn<RunApiScript>().mockResolvedValue("");
    await jobsRedispatch(appDev, { yes: true, dryRun: true }, runScript);
    await jobsRedispatch(local, { dryRun: true }, runScript);

    expect(runRedispatchTaskMock).toHaveBeenCalledWith(appDev, {
      dryRun: true,
    });
    expect(runScript).toHaveBeenCalledWith(local, "jobs:redispatch", [
      "--dry-run",
    ]);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe("jobsRedispatch returns the pass's summary (#852 review)", () => {
  it("local: parses the summary line out of the script's stdout", async () => {
    const runScript = jest
      .fn<RunApiScript>()
      .mockResolvedValue(
        `> @portalai/api jobs:redispatch\nINFO REDISPATCH COMPLETE\n${JSON.stringify(SUMMARY)}\n`
      );
    const out = await jobsRedispatch(local, {}, runScript);
    expect(out.summary).toEqual(SUMMARY);
  });

  it("ECS: reads the summary back from the task's CloudWatch stream", async () => {
    runRedispatchTaskMock.mockResolvedValue({
      taskArn: "rd-arn",
      exitCode: 0,
      log: LOG,
    });
    const readLog = jest.fn(async () =>
      [
        '{"level":30,"msg":"REDISPATCH COMPLETE"}',
        JSON.stringify(SUMMARY),
      ].join("\n")
    );
    const out = await jobsRedispatch(
      appDev,
      { yes: true },
      jest.fn<RunApiScript>(),
      readLog
    );
    expect(readLog).toHaveBeenCalledWith(LOG);
    expect(out.summary).toEqual(SUMMARY);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ redispatched: 1 }),
      })
    );
  });

  it("ECS: a failed log read keeps the run's result, with a null summary", async () => {
    runRedispatchTaskMock.mockResolvedValue({
      taskArn: "rd-arn",
      exitCode: 0,
      log: LOG,
    });
    const errSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
    const out = await jobsRedispatch(
      appDev,
      { yes: true },
      jest.fn<RunApiScript>(),
      async () => {
        throw new Error("AccessDenied");
      }
    );
    errSpy.mockRestore();
    expect(out).toMatchObject({ via: "ecs", exitCode: 0, summary: null });
  });
});
