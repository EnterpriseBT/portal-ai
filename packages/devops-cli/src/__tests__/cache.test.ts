import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvConfirmationRequiredError,
  EnvDestructiveBlockedError,
  EnvNotConfiguredError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

/**
 * `portalops cache …` and `service scale` (#852), against a fake AWS: one
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
};

class Cmd {
  constructor(public readonly input: Record<string, unknown>) {}
}
const named = (name: string) =>
  ({ [name]: class extends Cmd {} })[name] as typeof Cmd;

const cfnSend = jest.fn(async (cmd: Cmd) => {
  const name = cmd.constructor.name;
  const stackName = cmd.input.StackName as string;
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
  if (name === "UpdateStackCommand") {
    if (aws.noUpdates) {
      const e = new Error("No updates are to be performed.");
      e.name = "ValidationError";
      throw e;
    }
    aws.updates.push(cmd.input as never);
    return {};
  }
  throw new Error(`unexpected ${name}`);
});
const stackWait = jest.fn(async () => ({ state: "SUCCESS" }));
jest.unstable_mockModule("@aws-sdk/client-cloudformation", () => ({
  CloudFormationClient: class {
    send = cfnSend;
  },
  DescribeStacksCommand: named("DescribeStacksCommand"),
  UpdateStackCommand: named("UpdateStackCommand"),
  waitUntilStackUpdateComplete: stackWait,
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
  waitUntilServicesStable: servicesStable,
}));

const countActive = jest.fn(async () => 0);
jest.unstable_mockModule("../commands/jobs.js", () => ({
  countActiveJobs: countActive,
}));

const { cacheStatus, cachePhase, cacheSwitch } =
  await import("../commands/cache.js");
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
      RedisCutoverPhase: "both",
    },
    "portalai-dev-backend": {
      Environment: "dev",
      DesiredCount: "1",
      ImageTag: "dev-abc",
      RedisEndpointSource: "legacy",
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
  aws.clusters = {
    "portalai-dev": {
      CacheClusterStatus: "available",
      AtRestEncryptionEnabled: false,
      TransitEncryptionEnabled: false,
    },
  };
  aws.service = { desired: 0, running: 0 };
  aws.updates = [];
  aws.noUpdates = false;
  countActive.mockReset().mockResolvedValue(0);
  cfnSend.mockClear();
  stackWait.mockClear();
  servicesStable.mockClear();
});

describe("cacheStatus", () => {
  it("reports the phase, the endpoint source, each cache's encryption and the service", async () => {
    const out = await cacheStatus(appDev);
    expect(out).toEqual({
      phase: "both",
      endpointSource: "legacy",
      caches: [
        {
          id: "portalai-dev",
          kind: "cache-cluster",
          status: "available",
          atRestEncryption: false,
          transitEncryption: false,
          transitEncryptionMode: null,
        },
        {
          id: "portalai-dev-tls",
          kind: "replication-group",
          status: "available",
          atRestEncryption: true,
          transitEncryption: true,
          transitEncryptionMode: "required",
        },
      ],
      service: { desired: 0, running: 0 },
    });
  });

  it("local has no stacks → exit-3 class error", async () => {
    await expect(cacheStatus(local)).rejects.toBeInstanceOf(
      EnvNotConfiguredError
    );
  });
});

describe("cachePhase", () => {
  it("changes only the phase, on the deployed template, and waits", async () => {
    aws.stacks["portalai-dev-cache"]!.RedisCutoverPhase = "legacy";
    const out = await cachePhase(appDev, "both", { yes: true });

    expect(out).toEqual({
      stack: "portalai-dev-cache",
      phase: "both",
      changed: true,
    });
    expect(lastUpdate().UsePreviousTemplate).toBe(true);
    expect(sent(lastUpdate())).toEqual({
      Environment: "<previous>",
      NodeType: "<previous>",
      RedisCutoverPhase: "both",
    });
    expect(stackWait).toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "cache phase" })
    );
  });

  it("refuses to retire the legacy cache while the backend still points at it", async () => {
    await expect(
      cachePhase(appDev, "encrypted", { yes: true })
    ).rejects.toMatchObject({ code: "CACHE_CUTOVER_CONFLICT" });
    expect(aws.updates).toEqual([]);
  });

  it("refuses to drop the encrypted cache while the backend points at it", async () => {
    aws.stacks["portalai-dev-backend"]!.RedisEndpointSource = "encrypted";
    await expect(
      cachePhase(appDev, "legacy", { yes: true })
    ).rejects.toMatchObject({ code: "CACHE_CUTOVER_CONFLICT" });
  });

  it("treats retiring the legacy cache as destructive (prod refuses)", async () => {
    mocks.assertOperationAllowed.mockImplementation((def, opts) => {
      if (
        (def as { kind: string }).kind === "production" &&
        (opts as { destructive: boolean }).destructive
      )
        throw new EnvDestructiveBlockedError("blocked");
    });
    aws.stacks["portalai-prod-backend"] = { RedisEndpointSource: "encrypted" };
    await expect(
      cachePhase(prod, "encrypted", { yes: true, confirmProd: true })
    ).rejects.toBeInstanceOf(EnvDestructiveBlockedError);

    aws.stacks["portalai-dev-backend"]!.RedisEndpointSource = "encrypted";
    await cachePhase(appDev, "encrypted", { yes: true });
    expect(mocks.assertOperationAllowed).toHaveBeenLastCalledWith(appDev, {
      destructive: true,
      confirmed: true,
      prodConfirmed: false,
    });
  });

  it("reports an already-applied phase as unchanged instead of failing", async () => {
    aws.noUpdates = true;
    const out = await cachePhase(appDev, "both", { yes: true });
    expect(out.changed).toBe(false);
    expect(stackWait).not.toHaveBeenCalled();
  });
});

describe("cacheSwitch", () => {
  it("points the backend at the encrypted cache with the service held at zero", async () => {
    const out = await cacheSwitch(appDev, "encrypted", { yes: true });

    expect(out).toEqual({
      stack: "portalai-dev-backend",
      endpointSource: "encrypted",
      changed: true,
    });
    expect(sent(lastUpdate())).toEqual({
      Environment: "<previous>",
      DesiredCount: "0",
      ImageTag: "<previous>",
      RedisEndpointSource: "encrypted",
    });
    expect(lastUpdate().Capabilities).toEqual(["CAPABILITY_NAMED_IAM"]);
  });

  it("refuses while the service runs tasks", async () => {
    aws.service = { desired: 1, running: 1 };
    await expect(
      cacheSwitch(appDev, "encrypted", { yes: true })
    ).rejects.toMatchObject({ code: "CACHE_CUTOVER_CONFLICT" });
    expect(aws.updates).toEqual([]);
  });

  it("refuses outside phase both", async () => {
    aws.stacks["portalai-dev-cache"]!.RedisCutoverPhase = "legacy";
    await expect(
      cacheSwitch(appDev, "encrypted", { yes: true })
    ).rejects.toMatchObject({ code: "CACHE_CUTOVER_CONFLICT" });
  });
});

describe("serviceScale", () => {
  it("scales through the backend stack's DesiredCount and waits for the service", async () => {
    aws.service = { desired: 1, running: 1 };
    const out = await serviceScale(appDev, 2, { yes: true });

    expect(out).toEqual({ service: "portalai-api-dev", desired: 2 });
    expect(sent(lastUpdate())).toMatchObject({
      DesiredCount: "2",
      RedisEndpointSource: "<previous>",
    });
    expect(servicesStable).toHaveBeenCalled();
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
