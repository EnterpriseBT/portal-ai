/**
 * `runApiTask` (#192, #581, #852; moved here from devops-cli in #1088): the
 * ECS one-off against an env's API service.
 */

import { jest } from "@jest/globals";

const ecsSend =
  jest.fn<
    (cmd: { constructor: { name: string }; input: unknown }) => Promise<unknown>
  >();
const waitMock = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ state: "SUCCESS" });
jest.unstable_mockModule("@aws-sdk/client-ecs", () => ({
  ECSClient: class {
    send = ecsSend;
  },
  DescribeServicesCommand: class {
    constructor(public readonly input: unknown) {}
  },
  DescribeTaskDefinitionCommand: class {
    constructor(public readonly input: unknown) {}
  },
  RunTaskCommand: class {
    constructor(public readonly input: unknown) {}
  },
  DescribeTasksCommand: class {
    constructor(public readonly input: unknown) {}
  },
  waitUntilTasksStopped: waitMock,
}));

const { runApiTask, apiServiceName, scriptErrorLines } =
  await import("../ecs-task.js");
const { EnvInfraError, EnvNotConfiguredError } = await import("../errors.js");
const { BUILTIN_ENVIRONMENTS } = await import("../registry.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"]!;
const local = BUILTIN_ENVIRONMENTS["local"]!;

const NETWORK = { awsvpcConfiguration: { subnets: ["s-1"] } };
const SPEC = {
  command: ["node", "dist/db/org-delete.js", "--org", "o-1"],
  label: "Org delete",
  localHint: "run it locally",
};
const AWSLOGS = {
  logDriver: "awslogs",
  options: {
    "awslogs-group": "/ecs/portalai-api-dev",
    "awslogs-region": "us-east-1",
    "awslogs-stream-prefix": "api",
  },
};
const LOG = {
  region: "us-east-1",
  group: "/ecs/portalai-api-dev",
  stream: "api/api/abc",
};

const ecsReturns = (exitCode: number, logConfiguration?: unknown) => {
  ecsSend.mockImplementation(async (cmd) => {
    switch (cmd.constructor.name) {
      case "DescribeServicesCommand":
        return {
          services: [
            {
              networkConfiguration: NETWORK,
              taskDefinition: "portalai-api:42",
            },
          ],
        };
      case "DescribeTaskDefinitionCommand":
        return {
          taskDefinition: {
            containerDefinitions: [{ name: "api", logConfiguration }],
          },
        };
      case "RunTaskCommand":
        return { tasks: [{ taskArn: "arn:aws:ecs:task/abc" }] };
      case "DescribeTasksCommand":
        return { tasks: [{ containers: [{ exitCode }] }] };
      default:
        throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  });
};

const noLog = jest.fn(async () => "");

beforeEach(() => {
  ecsSend.mockReset();
  waitMock.mockClear();
  noLog.mockClear();
});

describe("runApiTask", () => {
  it("service config → task def → run-task override → wait → exit code", async () => {
    ecsReturns(0);
    const out = await runApiTask(appDev, SPEC, noLog);
    expect(out).toEqual({ taskArn: "arn:aws:ecs:task/abc", exitCode: 0 });

    const calls = ecsSend.mock.calls.map((c) => c[0]);
    expect(calls[0]!.constructor.name).toBe("DescribeServicesCommand");
    expect(calls[0]!.input).toMatchObject({
      cluster: "portalai-dev",
      services: ["portalai-api-dev"],
    });
    const runTask = calls.find((c) => c.constructor.name === "RunTaskCommand")!;
    expect(runTask.input).toMatchObject({
      cluster: "portalai-dev",
      taskDefinition: "portalai-api:42",
      launchType: "FARGATE",
      networkConfiguration: NETWORK,
      overrides: {
        containerOverrides: [{ name: "api", command: SPEC.command }],
      },
    });
    expect(waitMock).toHaveBeenCalled();
    expect(noLog).not.toHaveBeenCalled();
  });

  it("returns the task's awslogs stream so its output can be read back", async () => {
    ecsReturns(0, AWSLOGS);
    const out = await runApiTask(appDev, SPEC, noLog);
    expect(out.log).toEqual(LOG);
  });

  it("a non-zero exit carries the script's own error lines from the log", async () => {
    ecsReturns(1, AWSLOGS);
    const readLog = jest.fn(async () =>
      [
        '{"level":30,"msg":"Deleting organization"}',
        "Organization is locked by an in-flight job:",
        "  sync j-1 (active)",
        '{"level":30,"msg":"pool closed"}',
      ].join("\n")
    );
    const p = runApiTask(appDev, SPEC, readLog);
    await expect(p).rejects.toBeInstanceOf(EnvInfraError);
    await expect(p).rejects.toThrow(
      "Org delete task exited with code 1: Organization is locked by an in-flight job:\nsync j-1 (active) (CloudWatch /ecs/portalai-api-dev/api/api/abc)"
    );
    expect(readLog).toHaveBeenCalledWith(LOG);
  });

  it("a non-zero exit whose log can't be read still points at CloudWatch", async () => {
    ecsReturns(1, AWSLOGS);
    const readLog = jest.fn(async () => {
      throw new Error("AccessDenied");
    });
    const p = runApiTask(appDev, SPEC, readLog);
    await expect(p).rejects.toBeInstanceOf(EnvInfraError);
    await expect(p).rejects.toThrow(
      /exited with code 1\. Check CloudWatch \/ecs\/portalai-api-dev/
    );
  });

  it("a non-zero exit with no awslogs names the task", async () => {
    ecsReturns(1);
    const p = runApiTask(appDev, SPEC, noLog);
    await expect(p).rejects.toThrow(
      /Check CloudWatch logs for task arn:aws:ecs:task\/abc/
    );
    expect(noLog).not.toHaveBeenCalled();
  });

  it("an env with no AWS is not configured, with the local hint", async () => {
    const p = runApiTask(local, SPEC, noLog);
    await expect(p).rejects.toBeInstanceOf(EnvNotConfiguredError);
    await expect(p).rejects.toThrow(/run it locally/);
    expect(ecsSend).not.toHaveBeenCalled();
  });

  it("an undeployed service is an infra error", async () => {
    ecsSend.mockResolvedValue({ services: [] });
    await expect(runApiTask(appDev, SPEC, noLog)).rejects.toThrow(
      /is the service deployed/
    );
  });
});

describe("apiServiceName", () => {
  it("names the env's API service; local has none", () => {
    expect(apiServiceName(appDev)).toBe("portalai-api-dev");
    expect(() => apiServiceName(local)).toThrow(EnvNotConfiguredError);
  });
});

describe("scriptErrorLines", () => {
  it("drops pino JSON and blank lines, keeping the last five", () => {
    const text = ["{}", "a", "", "b", "c", "d", "e", "f", '{"x":1}'].join("\n");
    expect(scriptErrorLines(text)).toEqual(["b", "c", "d", "e", "f"]);
  });
});
