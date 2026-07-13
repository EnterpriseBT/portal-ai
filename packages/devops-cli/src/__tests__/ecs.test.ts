import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  BUILTIN_ENVIRONMENTS,
  EnvInfraError,
  EnvNotConfiguredError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

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

const { runSeedTask } = await import("../ecs.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const local = BUILTIN_ENVIRONMENTS["local"];

const NETWORK = { awsvpcConfiguration: { subnets: ["s-1"] } };

const happyPath = (exitCode: number) => {
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
        return { taskDefinition: { containerDefinitions: [{ name: "api" }] } };
      case "RunTaskCommand":
        return { tasks: [{ taskArn: "arn:aws:ecs:task/abc" }] };
      case "DescribeTasksCommand":
        return { tasks: [{ containers: [{ exitCode }] }] };
      default:
        throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  });
};

beforeEach(() => {
  resetCliEnvMocks();
  ecsSend.mockReset();
  waitMock.mockClear();
});

describe("runSeedTask", () => {
  it("ports the bash sequence: service config → task def → run-task override → wait → exit code", async () => {
    happyPath(0);
    const out = await runSeedTask(appDev);
    expect(out).toEqual({ taskArn: "arn:aws:ecs:task/abc", exitCode: 0 });

    const calls = ecsSend.mock.calls.map((c) => c[0]);
    expect(calls[0].constructor.name).toBe("DescribeServicesCommand");
    expect(calls[0].input).toMatchObject({
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
        containerOverrides: [
          { name: "api", command: ["npm", "run", "db:seed:ci"] },
        ],
      },
    });
    expect(waitMock).toHaveBeenCalled();
  });

  it("non-zero container exit → ENV_INFRA_ERROR naming CloudWatch", async () => {
    happyPath(1);
    const p = runSeedTask(appDev);
    await expect(p).rejects.toBeInstanceOf(EnvInfraError);
    await expect(p).rejects.toThrow(/CloudWatch/);
  });

  it("local (no AWS) → typed pointer at npm run db:seed", async () => {
    const p = runSeedTask(local);
    await expect(p).rejects.toBeInstanceOf(EnvNotConfiguredError);
    await expect(p).rejects.toThrow(/npm run db:seed/);
    expect(ecsSend).not.toHaveBeenCalled();
  });
});
