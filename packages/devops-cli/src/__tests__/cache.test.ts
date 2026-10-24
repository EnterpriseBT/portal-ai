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
  changeSet: { status: "FAILED", reason: "", changes: [] } as {
    status: string;
    reason: string;
    changes: Array<{ ResourceChange: Record<string, unknown> }>;
  },
  changeSetCalls: [] as string[],
  lastChangeSetParameters: [] as Array<{
    ParameterKey: string;
    ParameterValue?: string;
    UsePreviousValue?: boolean;
  }>,
  executedParameters: null as null | Array<{
    ParameterKey: string;
    ParameterValue?: string;
    UsePreviousValue?: boolean;
  }>,
  executeError: "",
  stackStatus: "UPDATE_COMPLETE",
  stackUpdated: 1_000,
  /** What the stack reports on each read after an execute. */
  afterExecute: [] as Array<{ status: string; updated: number }>,
};
const NO_CHANGES =
  "The submitted information didn't contain changes. Submit different information to create a change set.";

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
    // After an execute, each read advances the stack along its timeline.
    const executedNow = aws.changeSetCalls.some((c) =>
      c.startsWith("execute:")
    );
    if (executedNow && aws.afterExecute.length) {
      const next = aws.afterExecute.shift()!;
      aws.stackStatus = next.status;
      aws.stackUpdated = next.updated;
    }
    return {
      Stacks: [
        {
          StackName: stackName,
          StackStatus: aws.stackStatus,
          LastUpdatedTime: new Date(aws.stackUpdated),
          Parameters: Object.entries(params).map(([k, v]) => ({
            ParameterKey: k,
            ParameterValue: v,
          })),
        },
      ],
    };
  }
  if (name === "CreateChangeSetCommand") {
    aws.changeSetCalls.push("create");
    aws.lastChangeSetParameters = cmd.input
      .Parameters as typeof aws.lastChangeSetParameters;
    return { Id: "cs-1" };
  }
  if (name === "DescribeChangeSetCommand") {
    // As in CloudFormation, executing a change set removes the stack's
    // change sets (#864).
    if (aws.changeSetCalls.some((c) => c.startsWith("execute:"))) {
      const e = new Error(
        `ChangeSet [${cmd.input.ChangeSetName}] does not exist`
      );
      e.name = "ChangeSetNotFoundException";
      throw e;
    }
    return {
      Status: aws.changeSet.status,
      StatusReason: aws.changeSet.reason,
      Changes: aws.changeSet.changes,
    };
  }
  if (name === "ExecuteChangeSetCommand") {
    if (aws.executeError) throw new Error(aws.executeError);
    aws.changeSetCalls.push(`execute:${cmd.input.ChangeSetName}`);
    aws.executedParameters = aws.lastChangeSetParameters;
    return {};
  }
  if (name === "DeleteChangeSetCommand") {
    aws.changeSetCalls.push("delete");
    return {};
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
  CreateChangeSetCommand: named("CreateChangeSetCommand"),
  DescribeChangeSetCommand: named("DescribeChangeSetCommand"),
  DeleteChangeSetCommand: named("DeleteChangeSetCommand"),
  ExecuteChangeSetCommand: named("ExecuteChangeSetCommand"),
  waitUntilStackUpdateComplete: stackWait,
  // A change set with no resource changes ends FAILED, which the waiter
  // reports as a failure; the caller reads the status itself.
  waitUntilChangeSetCreateComplete: jest.fn(async () => {
    if (aws.changeSet.status === "FAILED") throw new Error("waiter failed");
    return { state: "SUCCESS" };
  }),
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

const { cacheStatus, cachePhase, cacheSwitch, cacheRefreshTemplate } =
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
  aws.changeSet = { status: "FAILED", reason: NO_CHANGES, changes: [] };
  aws.changeSetCalls = [];
  aws.executedParameters = null;
  aws.lastChangeSetParameters = [];
  aws.stackStatus = "UPDATE_COMPLETE";
  aws.stackUpdated = 1_000;
  aws.afterExecute = [
    { status: "UPDATE_IN_PROGRESS", updated: 2_000 },
    { status: "UPDATE_COMPLETE", updated: 2_000 },
  ];
  aws.executeError = "";
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
  it("scales through the backend stack's DesiredCount, waiting on the stack alone", async () => {
    aws.service = { desired: 1, running: 1 };
    const out = await serviceScale(appDev, 2, { yes: true });

    expect(out).toEqual({
      service: "portalai-api-dev",
      desired: 2,
      changed: true,
    });
    expect(sent(lastUpdate())).toMatchObject({
      DesiredCount: "2",
      RedisEndpointSource: "<previous>",
    });
    // CloudFormation completes an ECS service update only once it is stable.
    expect(stackWait).toHaveBeenCalled();
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

/**
 * #861: the deploy workflows never apply a template whose only changes are
 * parameters, conditions and outputs (a change set with no resource changes
 * is skipped), so the deployed cache template can predate RedisCutoverPhase.
 * `cache refresh-template` applies main's template explicitly, previewed.
 */
describe("cacheRefreshTemplate (#861)", () => {
  const TEMPLATE = {
    path: "/repo/infra/cloudformation/cache.yml",
    body: [
      "Parameters:",
      "  Environment:",
      "    Type: String",
      "    Default: dev",
      "  NodeType:",
      "    Type: String",
      "# ── a column-0 banner inside Parameters ──",
      "  RedisCutoverPhase:",
      "    Type: String",
      "    Default: legacy",
      "Resources: {}",
      "",
    ].join("\n"),
  };
  const onMain = { head: "abc123", main: "abc123", dirty: false };
  const deps = (
    over: Partial<{ template: typeof TEMPLATE | null; git: typeof onMain }> = {}
  ) => ({
    readTemplate: () => ("template" in over ? over.template! : TEMPLATE),
    gitState: () => over.git ?? onMain,
    sleep: async () => {},
  });

  beforeEach(() => {
    delete aws.stacks["portalai-dev-cache"]!.RedisCutoverPhase;
  });

  it("refuses (exit 9) a preview with no resource changes, naming --phase both: CloudFormation won't apply a template-only change", async () => {
    await expect(
      cacheRefreshTemplate(appDev, { yes: true }, deps())
    ).rejects.toThrow(/--phase both/);
    expect(aws.updates).toEqual([]);
    expect(aws.changeSetCalls).toEqual(["create", "delete"]);
  });

  it("reports an already-current template as unchanged, not a refusal", async () => {
    aws.stacks["portalai-dev-cache"]!.RedisCutoverPhase = "both";
    const out = await cacheRefreshTemplate(appDev, { yes: true }, deps());
    expect(out.changed).toBe(false);
    expect(aws.changeSetCalls).toEqual(["create", "delete"]);
  });

  it("runs the mutation guard before any AWS call", async () => {
    mocks.assertOperationAllowed.mockImplementation(() => {
      throw new EnvConfirmationRequiredError("needs --yes");
    });
    await expect(
      cacheRefreshTemplate(appDev, {}, deps())
    ).rejects.toBeInstanceOf(EnvConfirmationRequiredError);
    expect(aws.changeSetCalls).toEqual([]);
    expect(cfnSend).not.toHaveBeenCalled();
  });

  it("treats a resource replacement or removal in the preview as destructive (prod refuses)", async () => {
    aws.changeSet = {
      status: "CREATE_COMPLETE",
      reason: "",
      changes: [
        {
          ResourceChange: {
            LogicalResourceId: "RedisCluster",
            Action: "Modify",
            Replacement: "True",
          },
        },
      ],
    };
    mocks.assertOperationAllowed.mockImplementation((def, o) => {
      if ((o as { destructive: boolean }).destructive)
        throw new EnvDestructiveBlockedError("blocked");
    });
    await expect(
      cacheRefreshTemplate(appDev, { yes: true }, deps())
    ).rejects.toBeInstanceOf(EnvDestructiveBlockedError);
    expect(aws.updates).toEqual([]);
    expect(aws.changeSetCalls).toEqual(["create", "delete"]);
  });

  it("--dry-run reports the preview and applies nothing", async () => {
    aws.changeSet = {
      status: "CREATE_COMPLETE",
      reason: "",
      changes: [{ ResourceChange: { LogicalResourceId: "X", Action: "Add" } }],
    };
    const out = await cacheRefreshTemplate(appDev, { dryRun: true }, deps());
    expect(out).toMatchObject({
      dryRun: true,
      changed: false,
      resourceChanges: [{ logicalId: "X", action: "Add", replacement: null }],
    });
    expect(aws.updates).toEqual([]);
  });

  it.each([
    [
      "a dirty checkout",
      { head: "abc", main: "abc", dirty: true },
      /uncommitted/,
    ],
    [
      "a checkout that isn't origin/main",
      { head: "abc", main: "def", dirty: false },
      /origin\/main/,
    ],
  ])("refuses (exit 9) from %s, before any AWS call", async (_l, git, msg) => {
    await expect(
      cacheRefreshTemplate(appDev, { yes: true }, deps({ git }))
    ).rejects.toThrow(msg);
    expect(aws.changeSetCalls).toEqual([]);
  });

  it("refuses (exit 9) outside a repo checkout", async () => {
    await expect(
      cacheRefreshTemplate(appDev, { yes: true }, deps({ template: null }))
    ).rejects.toMatchObject({
      code: "CACHE_CUTOVER_CONFLICT",
    });
  });

  it("refuses (exit 9) a new parameter with no default the stack can't supply", async () => {
    const body = TEMPLATE.body.replace(
      "  RedisCutoverPhase:\n    Type: String\n    Default: legacy",
      "  Required:\n    Type: String"
    );
    await expect(
      cacheRefreshTemplate(
        appDev,
        { yes: true },
        deps({ template: { path: TEMPLATE.path, body } })
      )
    ).rejects.toThrow(/Required/);
    expect(aws.changeSetCalls).toEqual([]);
  });

  /**
   * The template alone never lands: CloudFormation answers a template-only
   * UpdateStack with "No updates are to be performed" too (measured on
   * app-dev). It lands with the resource change the phase makes, so
   * `--phase` applies main's template with the phase set, by executing the
   * previewed change set.
   */
  describe("--phase", () => {
    const addsGroup = () => {
      aws.changeSet = {
        status: "CREATE_COMPLETE",
        reason: "",
        changes: [
          {
            ResourceChange: {
              LogicalResourceId: "EncryptedRedisReplicationGroup",
              Action: "Add",
            },
          },
        ],
      };
    };

    it("sets the phase alongside the template, and executes exactly the previewed change set", async () => {
      addsGroup();
      const out = await cacheRefreshTemplate(
        appDev,
        { yes: true, phase: "both" },
        deps()
      );

      const sentParams = Object.fromEntries(
        aws.executedParameters!.map((p) => [
          p.ParameterKey,
          p.UsePreviousValue ? "<previous>" : p.ParameterValue,
        ])
      );
      expect(sentParams).toEqual({
        Environment: "<previous>",
        NodeType: "<previous>",
        RedisCutoverPhase: "both",
      });
      expect(aws.changeSetCalls).toEqual([
        "create",
        expect.stringMatching(/^execute:portalops-refresh-/),
      ]);
      expect(aws.updates).toEqual([]);
      expect(aws.stackStatus).toBe("UPDATE_COMPLETE");
      expect(out).toMatchObject({
        changed: true,
        phase: "both",
        resourceChanges: [
          {
            logicalId: "EncryptedRedisReplicationGroup",
            action: "Add",
            replacement: null,
          },
        ],
      });
      expect(mocks.assertOperationAllowed).toHaveBeenLastCalledWith(appDev, {
        destructive: false,
        confirmed: true,
        prodConfirmed: false,
      });
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({ phase: "both" }),
        })
      );
    });

    it("holds cache phase's preconditions: no retiring the legacy cache the backend still uses", async () => {
      await expect(
        cacheRefreshTemplate(appDev, { yes: true, phase: "encrypted" }, deps())
      ).rejects.toMatchObject({ code: "CACHE_CUTOVER_CONFLICT" });
      expect(aws.changeSetCalls).toEqual([]);
    });

    it("refuses a phase the template doesn't declare", async () => {
      const body = TEMPLATE.body.replace(
        "  RedisCutoverPhase:\n    Type: String\n    Default: legacy\n",
        ""
      );
      await expect(
        cacheRefreshTemplate(
          appDev,
          { yes: true, phase: "both" },
          deps({ template: { path: TEMPLATE.path, body } })
        )
      ).rejects.toThrow(/RedisCutoverPhase/);
      expect(aws.changeSetCalls).toEqual([]);
    });

    it("never trusts a change set that isn't CREATE_COMPLETE: refuses, applies nothing, deletes it", async () => {
      aws.changeSet = { status: "CREATE_PENDING", reason: "", changes: [] };
      await expect(
        cacheRefreshTemplate(appDev, { yes: true, phase: "both" }, deps())
      ).rejects.toThrow(/CREATE_PENDING/);
      expect(aws.updates).toEqual([]);
      expect(aws.changeSetCalls).toEqual(["create", "delete"]);
    });

    it("deletes the change set when executing it fails", async () => {
      addsGroup();
      aws.executeError = "Stack is in UPDATE_IN_PROGRESS state";
      await expect(
        cacheRefreshTemplate(appDev, { yes: true, phase: "both" }, deps())
      ).rejects.toMatchObject({ code: "ENV_INFRA_ERROR" });
      expect(aws.changeSetCalls).toEqual(["create", "delete"]);
    });

    it("waits for the stack itself to finish, not the change set CloudFormation removes on execute (#864)", async () => {
      addsGroup();
      const sleep = jest.fn(async () => {});
      const out = await cacheRefreshTemplate(
        appDev,
        { yes: true, phase: "both" },
        { ...deps(), sleep }
      );
      expect(out.changed).toBe(true);
      expect(sleep).toHaveBeenCalled();
      expect(mocks.recordAudit).toHaveBeenCalled();
    });

    it("doesn't take the stack's previous UPDATE_COMPLETE for this update's", async () => {
      addsGroup();
      aws.afterExecute = [
        { status: "UPDATE_COMPLETE", updated: 1_000 }, // not started yet
        { status: "UPDATE_IN_PROGRESS", updated: 2_000 },
        { status: "UPDATE_COMPLETE", updated: 2_000 },
      ];
      const sleep = jest.fn(async () => {});
      await cacheRefreshTemplate(
        appDev,
        { yes: true, phase: "both" },
        { ...deps(), sleep }
      );
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("fails, unaudited, when the update rolls back", async () => {
      addsGroup();
      aws.afterExecute = [
        { status: "UPDATE_IN_PROGRESS", updated: 2_000 },
        { status: "UPDATE_ROLLBACK_COMPLETE", updated: 2_000 },
      ];
      await expect(
        cacheRefreshTemplate(appDev, { yes: true, phase: "both" }, deps())
      ).rejects.toThrow(/UPDATE_ROLLBACK_COMPLETE/);
      expect(mocks.recordAudit).not.toHaveBeenCalled();
    });

    it("--dry-run previews the phase's changes and deletes the change set", async () => {
      addsGroup();
      const out = await cacheRefreshTemplate(
        appDev,
        { dryRun: true, phase: "both" },
        deps()
      );
      expect(out).toMatchObject({
        dryRun: true,
        changed: false,
        phase: "both",
      });
      expect(aws.changeSetCalls).toEqual(["create", "delete"]);
    });
  });

  it("cache phase still refuses a parameter the deployed template lacks, pointing at refresh-template", async () => {
    await expect(cachePhase(appDev, "both", { yes: true })).rejects.toThrow(
      /refresh-template/
    );
    expect(aws.updates).toEqual([]);
  });
});
