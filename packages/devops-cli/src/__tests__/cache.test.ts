import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvConfirmationRequiredError,
  EnvNotConfiguredError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

/**
 * `portalops cache status` and `service scale` (#852, #872), against a fake AWS: one
 * object holds the stacks' parameters, the caches and the ECS service, and
 * each mocked SDK client reads or records against it. The assertions are on
 * what reaches CloudFormation, since that is the whole effect.
 */

type Params = Record<string, string>;
const aws = {
  stacks: {} as Record<string, Params>,
  groups: {} as Record<string, Record<string, unknown>>,
  clusters: {} as Record<string, Record<string, unknown>>,
  service: { desired: 1, running: 1 },
  updates: [] as Array<{
    StackName: string;
    UsePreviousTemplate: boolean;
    Parameters: Array<{
      ParameterKey: string;
      ParameterValue?: string;
      UsePreviousValue?: boolean;
    }>;
    Capabilities?: string[];
  }>,
  noUpdates: false,
  /** Stack events, newest first, as DescribeStackEvents returns them. */
  events: [] as Array<Record<string, unknown>>,
  eventReads: 0,
  /** The statuses an operation passes through, one per events read. */
  outcome: ["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE"] as string[],
  inFlight: null as null | { token: string; steps: string[] },
  tokens: [] as string[],
};
class Cmd {
  constructor(public readonly input: Record<string, unknown>) {}
}
const named = (name: string) =>
  ({ [name]: class extends Cmd {} })[name] as typeof Cmd;

const cfnSend = jest.fn(async (cmd: Cmd) => {
  const name = cmd.constructor.name;
  const stackName = cmd.input.StackName as string;
  /** Start an operation: its events appear one per DescribeStackEvents. */
  const begin = () => {
    const token = cmd.input.ClientRequestToken as string;
    aws.tokens.push(token);
    aws.inFlight = { token, steps: [...aws.outcome] };
  };
  if (name === "DescribeStacksCommand") {
    const params = aws.stacks[stackName];
    if (!params) throw new Error(`Stack ${stackName} does not exist`);
    return {
      Stacks: [
        {
          StackName: stackName,
          Parameters: Object.entries(params).map(([k, v]) => ({
            ParameterKey: k,
            ParameterValue: v,
          })),
        },
      ],
    };
  }
  if (name === "DescribeStackEventsCommand") {
    if (!aws.stacks[stackName]) {
      throw new Error(`Stack [${stackName}] does not exist`);
    }
    aws.eventReads++;
    if (aws.inFlight && aws.inFlight.steps.length) {
      aws.events.unshift({
        LogicalResourceId: stackName,
        ResourceType: "AWS::CloudFormation::Stack",
        ResourceStatus: aws.inFlight.steps.shift()!,
        ResourceStatusReason: "reason from CloudFormation",
        ClientRequestToken: aws.inFlight.token,
      });
    }
    return { StackEvents: aws.events };
  }
  if (name === "UpdateStackCommand") {
    if (aws.noUpdates) {
      const e = new Error("No updates are to be performed.");
      e.name = "ValidationError";
      throw e;
    }
    aws.updates.push(cmd.input as never);
    begin();
    return {};
  }
  throw new Error(`unexpected ${name}`);
});
jest.unstable_mockModule("@aws-sdk/client-cloudformation", () => ({
  CloudFormationClient: class {
    send = cfnSend;
  },
  DescribeStacksCommand: named("DescribeStacksCommand"),
  DescribeStackEventsCommand: named("DescribeStackEventsCommand"),
  UpdateStackCommand: named("UpdateStackCommand"),
}));

const notFound = (name: string) => {
  const e = new Error("not found");
  e.name = name;
  return e;
};
jest.unstable_mockModule("@aws-sdk/client-elasticache", () => ({
  ElastiCacheClient: class {
    send = async (cmd: Cmd) => {
      if (cmd.constructor.name === "DescribeReplicationGroupsCommand") {
        const g = aws.groups[cmd.input.ReplicationGroupId as string];
        if (!g) throw notFound("ReplicationGroupNotFoundFault");
        return { ReplicationGroups: [g] };
      }
      const c = aws.clusters[cmd.input.CacheClusterId as string];
      if (!c) throw notFound("CacheClusterNotFoundFault");
      return { CacheClusters: [c] };
    };
  },
  DescribeReplicationGroupsCommand: named("DescribeReplicationGroupsCommand"),
  DescribeCacheClustersCommand: named("DescribeCacheClustersCommand"),
}));

const servicesStable = jest.fn(async () => ({ state: "SUCCESS" }));
jest.unstable_mockModule("@aws-sdk/client-ecs", () => ({
  ECSClient: class {
    send = async () => ({
      services: [
        {
          desiredCount: aws.service.desired,
          runningCount: aws.service.running,
        },
      ],
    });
  },
  DescribeServicesCommand: named("DescribeServicesCommand"),
  // ecs.ts (the shared service name) imports these; unused here.
  DescribeTaskDefinitionCommand: named("DescribeTaskDefinitionCommand"),
  DescribeTasksCommand: named("DescribeTasksCommand"),
  RunTaskCommand: named("RunTaskCommand"),
  waitUntilTasksStopped: jest.fn(),
  waitUntilServicesStable: servicesStable,
}));

const countActive = jest.fn(async () => 0);
jest.unstable_mockModule("../commands/jobs.js", () => ({
  countActiveJobs: countActive,
}));

const { cacheStatus, stackTiming } = await import("../commands/cache.js");
const { serviceScale } = await import("../commands/service.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const prod = BUILTIN_ENVIRONMENTS["prod"];
const local = BUILTIN_ENVIRONMENTS["local"];

const lastUpdate = () => aws.updates[aws.updates.length - 1]!;
const sent = (u: ReturnType<typeof lastUpdate>) =>
  Object.fromEntries(
    u.Parameters.map((p) => [
      p.ParameterKey,
      p.UsePreviousValue ? "<previous>" : p.ParameterValue,
    ])
  );

beforeEach(() => {
  resetCliEnvMocks();
  aws.stacks = {
    "portalai-dev-cache": {
      Environment: "dev",
      NodeType: "cache.t4g.micro",
    },
    "portalai-dev-backend": {
      Environment: "dev",
      DesiredCount: "1",
      ImageTag: "dev-abc",
    },
  };
  aws.groups = {
    "portalai-dev-tls": {
      Status: "available",
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true,
      TransitEncryptionMode: "required",
    },
  };
  aws.clusters = {};
  aws.service = { desired: 0, running: 0 };
  aws.updates = [];
  aws.noUpdates = false;
  aws.events = [];
  aws.eventReads = 0;
  aws.outcome = ["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE"];
  aws.inFlight = null;
  aws.tokens = [];
  stackTiming.sleep = async () => {};
  countActive.mockReset().mockResolvedValue(0);
  cfnSend.mockClear();
  servicesStable.mockClear();
});

const TLS = {
  id: "portalai-dev-tls",
  kind: "replication-group",
  status: "available",
  atRestEncryption: true,
  transitEncryption: true,
  transitEncryptionMode: "required",
};

describe("cacheStatus", () => {
  it("reports each cache's encryption and the service", async () => {
    expect(await cacheStatus(appDev)).toEqual({
      caches: [TLS],
      service: { desired: 0, running: 0 },
    });
  });

  it("shows a leftover plaintext cache instead of hiding it (#872)", async () => {
    aws.clusters = {
      "portalai-dev": {
        CacheClusterStatus: "available",
        AtRestEncryptionEnabled: false,
        TransitEncryptionEnabled: false,
      },
    };
    aws.groups["portalai-dev"] = {
      Status: "deleting",
      AtRestEncryptionEnabled: false,
      TransitEncryptionEnabled: false,
    };
    const { caches } = await cacheStatus(appDev);
    expect(caches.map((c) => [c.id, c.kind, c.atRestEncryption])).toEqual([
      ["portalai-dev", "cache-cluster", false],
      ["portalai-dev", "replication-group", false],
      ["portalai-dev-tls", "replication-group", true],
    ]);
  });

  it("local has no stacks → exit-3 class error", async () => {
    await expect(cacheStatus(local)).rejects.toBeInstanceOf(
      EnvNotConfiguredError
    );
  });
});

describe("serviceScale", () => {
  it("scales through the backend stack's DesiredCount, waiting on the stack alone", async () => {
    aws.service = { desired: 1, running: 1 };
    const out = await serviceScale(appDev, 2, { yes: true });

    expect(out).toEqual({
      service: "portalai-api-dev",
      desired: 2,
      changed: true,
    });
    // Only DesiredCount moves; everything else keeps its value.
    expect(sent(lastUpdate())).toEqual({
      Environment: "<previous>",
      DesiredCount: "2",
      ImageTag: "<previous>",
    });
    expect(lastUpdate().UsePreviousTemplate).toBe(true);
    // CloudFormation completes an ECS service update only once it is stable.
    // Waited on this operation's own stack events.
    expect(aws.events[0]).toMatchObject({
      ResourceStatus: "UPDATE_COMPLETE",
      ClientRequestToken: aws.tokens[0],
    });
    expect(servicesStable).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "service scale" })
    );
  });

  it("refuses to scale to zero while jobs are running (exit 5) unless --allow-active", async () => {
    countActive.mockResolvedValue(3);
    await expect(serviceScale(appDev, 0, { yes: true })).rejects.toBeInstanceOf(
      EnvConfirmationRequiredError
    );
    expect(aws.updates).toEqual([]);

    await serviceScale(appDev, 0, { yes: true, allowActive: true });
    expect(sent(lastUpdate()).DesiredCount).toBe("0");
  });

  it("doesn't count jobs when scaling up", async () => {
    await serviceScale(appDev, 1, { yes: true });
    expect(countActive).not.toHaveBeenCalled();
  });

  it("runs the mutation guard with the prod barrier flags", async () => {
    aws.stacks["portalai-prod-backend"] = { DesiredCount: "2" };
    await serviceScale(prod, 2, { yes: true, confirmProd: true });
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(prod, {
      destructive: false,
      confirmed: true,
      prodConfirmed: true,
    });
  });
});

describe("serviceScale — no-op (#852 review)", () => {
  it("doesn't audit a scale that changed nothing", async () => {
    aws.noUpdates = true;
    const out = await serviceScale(appDev, 1, { yes: true });
    expect(out.changed).toBe(false);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe("serviceScale — waiting on the stack (#864)", () => {
  it("ignores another operation's events (a concurrent deploy's UPDATE_COMPLETE isn't ours)", async () => {
    aws.events = [
      {
        LogicalResourceId: "portalai-dev-backend",
        ResourceType: "AWS::CloudFormation::Stack",
        ResourceStatus: "UPDATE_COMPLETE",
        ClientRequestToken: "someone-elses-deploy",
      },
    ];
    aws.outcome = ["UPDATE_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE"];
    await expect(serviceScale(appDev, 1, { yes: true })).rejects.toThrow(
      /UPDATE_ROLLBACK_COMPLETE/
    );
  });

  it("fails, unaudited, naming the status and reason, when the update rolls back", async () => {
    aws.outcome = [
      "UPDATE_IN_PROGRESS",
      "UPDATE_ROLLBACK_IN_PROGRESS",
      "UPDATE_ROLLBACK_COMPLETE",
    ];
    await expect(serviceScale(appDev, 1, { yes: true })).rejects.toThrow(
      /UPDATE_ROLLBACK_COMPLETE.*reason from CloudFormation/
    );
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("refuses an override the deployed template doesn't declare, before any update", async () => {
    delete aws.stacks["portalai-dev-backend"]!.DesiredCount;
    await expect(serviceScale(appDev, 1, { yes: true })).rejects.toThrow(
      /has no DesiredCount parameter/
    );
    expect(aws.updates).toEqual([]);
  });
});
