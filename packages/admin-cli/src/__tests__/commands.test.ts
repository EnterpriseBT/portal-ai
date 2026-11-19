import { jest } from "@jest/globals";
import os from "node:os";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvNotAuthorizedError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

// The store is unit-tested against real Postgres; commands assert calls.
const mockStore = {
  listOrgs: jest.fn<() => Promise<unknown[]>>(),
  getOrg: jest.fn<() => Promise<unknown>>(),
  updateOrg: jest.fn<() => Promise<unknown>>(),
  setTier: jest.fn<() => Promise<unknown>>(),
  softDeleteOrg: jest.fn<() => Promise<void>>(),
  softDeleteDemoOrg: jest.fn<() => Promise<void>>(),
  getTier: jest.fn<(slug: string) => Promise<{ slug: string }>>(),
  listUsers: jest.fn<() => Promise<unknown[]>>(),
  getUserByEmail: jest.fn<(email: string) => Promise<{ id: string }>>(),
  addMember: jest.fn<() => Promise<void>>(),
  removeMember: jest.fn<() => Promise<void>>(),
  switchMember: jest.fn<() => Promise<void>>(),
  close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};
const createDbAdminStoreMock = jest.fn(() => mockStore);
jest.unstable_mockModule("../store.js", () => ({
  createDbAdminStore: createDbAdminStoreMock,
}));

const { orgUpdate, orgSetTier, orgDelete } = await import("../commands/org.js");
const { AdminConflictError } = await import("../errors.js");
const { memberAdd, memberSwitch } = await import("../commands/member.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"]; // kind: staging
const local = BUILTIN_ENVIRONMENTS["local"]; // kind: development

// A structurally-valid JWT whose payload carries the sub (attribution only).
const SUB = "google-oauth2|10935499";
const TOKEN = `h.${Buffer.from(JSON.stringify({ sub: SUB })).toString("base64url")}.s`;

const disposeMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  resetCliEnvMocks();
  for (const fn of Object.values(mockStore)) fn.mockReset();
  mockStore.close.mockResolvedValue(undefined);
  createDbAdminStoreMock.mockClear();
  disposeMock.mockReset().mockResolvedValue(undefined);
  mocks.resolveEnvConnection.mockResolvedValue({
    env: "x",
    kind: "staging",
    apiBaseUrl: "x",
    db: async () => ({
      connectionString: "postgresql://u:p@localhost:15432/db",
      close: async () => {},
    }),
    token: async () => "t",
    dispose: disposeMock,
  });
  mocks.getToken.mockResolvedValue(TOKEN);
});

describe("the session requirement (staging/prod mutations)", () => {
  it("staging mutation with no device-flow session → ENV_NOT_AUTHORIZED naming portalai login; nothing runs", async () => {
    mocks.getToken.mockRejectedValue(new EnvNotAuthorizedError("no session"));
    const p = orgUpdate(appDev, "o-1", { name: "X" }, { yes: true });
    await expect(p).rejects.toBeInstanceOf(EnvNotAuthorizedError);
    await expect(p).rejects.toThrow(/portalai login/);
    expect(createDbAdminStoreMock).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("staging mutation with a session → audit operator is the token's sub", async () => {
    mockStore.updateOrg.mockResolvedValue({
      org: { id: "o-1", name: "X" },
      changes: {},
    });
    await orgUpdate(appDev, "o-1", { name: "X" }, { yes: true });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operator: SUB, command: "org update" })
    );
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
  });

  it("local mutations are exempt — operator falls back to the OS username", async () => {
    mocks.getToken.mockRejectedValue(new EnvNotAuthorizedError("no session"));
    mockStore.updateOrg.mockResolvedValue({ org: { id: "o-1" }, changes: {} });
    await orgUpdate(local, "o-1", { name: "X" }, {});
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operator: os.userInfo().username })
    );
  });
});

// #936: portalai holds no Stripe credential, so a rename of an org with a
// Stripe customer reports the command that keeps the customer's name in step.
describe("org update — the Stripe name step", () => {
  const renamed = (stripeCustomerId: string | null) => ({
    org: { id: "o-1", name: "Acme Corp", stripeCustomerId },
    changes: { name: { from: "Acme", to: "Acme Corp" } },
  });

  it("a rename of an org with a customer names the stripe command", async () => {
    mockStore.updateOrg.mockResolvedValue(renamed("cus_1"));

    const out = await orgUpdate(
      appDev,
      "o-1",
      { name: "Acme Corp" },
      { yes: true }
    );

    expect(out.stripe).toEqual({
      action: "update_customer_name",
      customerId: "cus_1",
      name: "Acme Corp",
      command:
        "stripe customers update 'cus_1' --name='Acme Corp' --project-name app-dev",
    });
  });

  it("selects the env's Stripe account, and live mode only in prod", async () => {
    mockStore.updateOrg.mockResolvedValue(renamed("cus_1"));

    const localOut = await orgUpdate(local, "o-1", { name: "Acme Corp" }, {});
    expect(localOut.stripe?.command).toBe(
      "stripe customers update 'cus_1' --name='Acme Corp'"
    );

    // The cli-env mock registers local + app-dev only; prod differs by name
    // and kind, which is all the Stripe step reads.
    const prod = { ...appDev, name: "prod", kind: "production" as const };
    const prodOut = await orgUpdate(
      prod,
      "o-1",
      { name: "Acme Corp" },
      { yes: true, confirmProd: true }
    );
    expect(prodOut.stripe?.command).toBe(
      "stripe customers update 'cus_1' --name='Acme Corp' --project-name prod --live"
    );
  });

  it("quotes a name with an apostrophe for the shell", async () => {
    mockStore.updateOrg.mockResolvedValue({
      org: { id: "o-1", name: "Bob's Co", stripeCustomerId: "cus_1" },
      changes: { name: { from: "Acme", to: "Bob's Co" } },
    });

    const out = await orgUpdate(
      appDev,
      "o-1",
      { name: "Bob's Co" },
      { yes: true }
    );

    expect(out.stripe?.command).toBe(
      `stripe customers update 'cus_1' --name='Bob'\\''s Co' --project-name app-dev`
    );
  });

  it.each([
    ["no Stripe customer", renamed(null)],
    [
      "an unchanged name",
      {
        org: { id: "o-1", name: "Acme", stripeCustomerId: "cus_1" },
        changes: {},
      },
    ],
    [
      "a station-only change",
      {
        org: { id: "o-1", name: "Acme", stripeCustomerId: "cus_1" },
        changes: { defaultStationId: { from: "a", to: "b" } },
      },
    ],
  ])("no stripe step for %s", async (_label, result) => {
    mockStore.updateOrg.mockResolvedValue(result);
    const out = await orgUpdate(appDev, "o-1", { name: "Acme" }, { yes: true });
    expect(out.stripe).toBeUndefined();
  });

  it("the local operator audit records the fields asked for and the ones that changed", async () => {
    mockStore.updateOrg.mockResolvedValue(renamed("cus_1"));
    await orgUpdate(
      appDev,
      "o-1",
      { name: "Acme Corp", timezone: "UTC" },
      { yes: true }
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "org update",
        args: {
          orgId: "o-1",
          requested: ["name", "timezone"],
          changed: ["name"],
        },
      })
    );
  });

  // The app's PATCH rules for a name (#907): trimmed, 1–120 characters, one
  // line. A refusal is a usage error (exit 2) before anything runs.
  it.each([
    ["a blank name", "   "],
    ["a 121-character name", "a".repeat(121)],
    ["a name with a line break", "Acme\nCorp"],
  ])("%s is ADMIN_INVALID_INPUT and nothing runs", async (_label, name) => {
    const p = orgUpdate(appDev, "o-1", { name }, { yes: true });
    await expect(p).rejects.toMatchObject({ code: "ADMIN_INVALID_INPUT" });
    expect(createDbAdminStoreMock).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("an update with no fields is ADMIN_INVALID_INPUT", async () => {
    await expect(
      orgUpdate(appDev, "o-1", {}, { yes: true })
    ).rejects.toMatchObject({ code: "ADMIN_INVALID_INPUT" });
    expect(createDbAdminStoreMock).not.toHaveBeenCalled();
  });

  it("passes the name trimmed, as the app stores it", async () => {
    mockStore.updateOrg.mockResolvedValue(renamed(null));
    await orgUpdate(appDev, "o-1", { name: "  Acme Corp  " }, { yes: true });
    expect(mockStore.updateOrg).toHaveBeenCalledWith(
      "o-1",
      { name: "Acme Corp" },
      SUB
    );
  });
});

describe("guard classes + audit hygiene", () => {
  it("org delete is destructive-class", async () => {
    mockStore.softDeleteOrg.mockResolvedValue(undefined);
    await orgDelete(appDev, "o-1", { yes: true });
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: true,
      confirmed: true,
      prodConfirmed: false,
    });
  });

  it("org set-tier audits old→new, ids only", async () => {
    mockStore.getOrg.mockResolvedValue({
      id: "o-1",
      stripeSubscriptionId: null,
    });
    mockStore.setTier.mockResolvedValue({
      id: "o-1",
      tier: "premium",
      previousTier: "standard",
    });
    const out = await orgSetTier(appDev, "o-1", "premium", { yes: true });
    expect(out).toEqual({
      id: "o-1",
      tier: "premium",
      previousTier: "standard",
    });
    const audit = mocks.recordAudit.mock.calls[0][0] as { args: unknown };
    expect(audit).toMatchObject({
      command: "org set-tier",
      args: { orgId: "o-1", tier: "premium", previousTier: "standard" },
    });
  });

  // #259: refuse set-tier on an org with a live Stripe subscription.
  it("org set-tier refuses (ADMIN_CONFLICT) when the org has a live Stripe subscription", async () => {
    mockStore.getOrg.mockResolvedValue({
      id: "o-1",
      stripeSubscriptionId: "sub_live_123",
    });
    const p = orgSetTier(appDev, "o-1", "standard", { yes: true });
    await expect(p).rejects.toBeInstanceOf(AdminConflictError);
    await expect(p).rejects.toHaveProperty("code", "ADMIN_CONFLICT");
    await expect(p).rejects.toThrow(/allow-stripe-desync/);
    expect(mockStore.setTier).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mockStore.close).toHaveBeenCalled(); // store still released
  });

  it("org set-tier proceeds with --allow-stripe-desync despite a live subscription", async () => {
    mockStore.getOrg.mockResolvedValue({
      id: "o-1",
      stripeSubscriptionId: "sub_live_123",
    });
    mockStore.setTier.mockResolvedValue({
      id: "o-1",
      tier: "standard",
      previousTier: "pro",
    });
    const out = await orgSetTier(appDev, "o-1", "standard", {
      yes: true,
      allowStripeDesync: true,
    });
    expect(out.tier).toBe("standard");
    expect(mockStore.setTier).toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "org set-tier" })
    );
  });

  it("store and connection are always released, even on store errors", async () => {
    mockStore.updateOrg.mockRejectedValue(new Error("boom"));
    await expect(
      orgUpdate(appDev, "o-1", { name: "X" }, { yes: true })
    ).rejects.toThrow("boom");
    expect(mockStore.close).toHaveBeenCalled();
    expect(disposeMock).toHaveBeenCalled();
  });
});

describe("spawn-backed provisioning commands", () => {
  const spawnerCalls: Array<{ args: string[]; env: Record<string, string> }> =
    [];
  const spawner = jest.fn(
    async (args: string[], env: Record<string, string>) => {
      spawnerCalls.push({ args, env });
      return {
        code: 0,
        stdout: '{"organizationId":"o-new","stationId":"st-1"}\n',
        stderr: "",
      };
    }
  );

  beforeEach(() => {
    spawnerCalls.length = 0;
    spawner.mockClear();
  });

  it("org create spawns the app's db:create-org with DATABASE_URL from the env connection", async () => {
    const { orgCreate } = await import("../commands/provision.js");
    const out = await orgCreate(
      appDev,
      { name: "Acme", ownerEmail: "ben@portalsai.io" },
      { yes: true },
      spawner
    );
    expect(out).toEqual({ organizationId: "o-new", stationId: "st-1" });
    expect(spawnerCalls[0].args).toEqual([
      "run",
      "--workspace",
      "@portalai/api",
      "db:create-org",
      "--",
      "--owner-email",
      "ben@portalsai.io",
      "--name",
      "Acme",
    ]);
    expect(spawnerCalls[0].env.DATABASE_URL).toBe(
      "postgresql://u:p@localhost:15432/db"
    );
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "org create", operator: SUB })
    );
  });

  it("seed org is destructive-class and passes --member-email through", async () => {
    const { seedOrg } = await import("../commands/provision.js");
    await seedOrg(
      appDev,
      { name: "QA Org", memberEmail: "ben@portalsai.io" },
      { yes: true },
      spawner
    );
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: true,
      confirmed: true,
      prodConfirmed: false,
    });
    expect(spawnerCalls[0].args).toEqual(
      expect.arrayContaining([
        "db:seed:org",
        "--name",
        "QA Org",
        "--member-email",
        "ben@portalsai.io",
      ])
    );
  });

  it("org reset guards BEFORE spawning — a blocked destructive op never runs the script", async () => {
    const { orgReset } = await import("../commands/provision.js");
    mocks.assertOperationAllowed.mockImplementation(() => {
      throw new EnvNotAuthorizedError("blocked");
    });
    await expect(orgReset(appDev, "o-1", {}, spawner)).rejects.toBeInstanceOf(
      EnvNotAuthorizedError
    );
    expect(spawner).not.toHaveBeenCalled();
    expect(mocks.resolveEnvConnection).not.toHaveBeenCalled();
  });
});

describe("demo create / demo delete (#1035)", () => {
  const prod = { ...appDev, name: "prod", kind: "production" as const };
  const ORG_JSON = JSON.stringify({
    organizationId: "o-demo",
    stationId: "st-demo",
    tier: "enterprise",
    rows: 10000,
  });
  const spawnerCalls: Array<{ args: string[]; env: Record<string, string> }> =
    [];
  const spawner = jest.fn(
    async (args: string[], env: Record<string, string>) => {
      spawnerCalls.push({ args, env });
      return { code: 0, stdout: `noise\n${ORG_JSON}\n`, stderr: "" };
    }
  );
  let stderr = "";
  let errSpy: ReturnType<typeof jest.spyOn>;

  const notFound = (name: string) =>
    Object.assign(new Error(name), { name }) as Error;

  beforeEach(() => {
    spawnerCalls.length = 0;
    spawner.mockClear();
    stderr = "";
    errSpy = jest.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string
    ) => {
      stderr += chunk;
      return true;
    }) as never);
    mockStore.getUserByEmail.mockResolvedValue({ id: "u-owner" });
    mockStore.getTier.mockImplementation(async (slug) => ({ slug }));
    mocks.getParam.mockResolvedValue("https://demo-toolpack.example");
    mocks.getSecret.mockImplementation(async (_def, name) =>
      name === "demo-toolpack-signing-secrets" ? "whsec_demo" : "other"
    );
  });
  afterEach(() => errSpy.mockRestore());

  const create = async (
    def: typeof appDev,
    opts: Partial<{
      name: string;
      ownerEmail: string;
      tier: string;
      rows: string;
    }> = {},
    flags: { yes?: boolean; confirmProd?: boolean } = { yes: true }
  ) => {
    const { demoCreate } = await import("../commands/demo.js");
    return demoCreate(
      def as never,
      { name: "Acme demo", ownerEmail: "owner@acme.test", ...opts },
      flags,
      spawner
    );
  };

  it("spawns db:demo:create with the defaults (enterprise, 10000 rows) and returns its report", async () => {
    const out = await create(appDev);
    expect(out).toEqual(JSON.parse(ORG_JSON));
    expect(spawnerCalls[0].args).toEqual([
      "run",
      "--workspace",
      "@portalai/api",
      "db:demo:create",
      "--",
      "--name",
      "Acme demo",
      "--owner-email",
      "owner@acme.test",
      "--tier",
      "enterprise",
      "--rows",
      "10000",
    ]);
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
  });

  it("passes --tier and --rows through, trimming the name", async () => {
    await create(appDev, { name: "  Acme  ", tier: "demo", rows: "1000000" });
    expect(spawnerCalls[0].args.slice(5)).toEqual([
      "--name",
      "Acme",
      "--owner-email",
      "owner@acme.test",
      "--tier",
      "demo",
      "--rows",
      "1000000",
    ]);
    expect(mockStore.getTier).toHaveBeenCalledWith("demo");
  });

  it("hands the env's toolpack URL and signing secret to the script", async () => {
    await create(appDev);
    expect(mocks.getParam).toHaveBeenCalledWith(appDev, "demo-toolpack-url");
    expect(mocks.getSecret).toHaveBeenCalledWith(
      appDev,
      "demo-toolpack-signing-secrets"
    );
    expect(spawnerCalls[0].env).toEqual(
      expect.objectContaining({
        DEMO_TOOLPACK_URL: "https://demo-toolpack.example",
        DEMO_TOOLPACK_SIGNING_SECRETS: "whsec_demo",
      })
    );
  });

  it("reads no AWS config on local (the shell / .env supplies it)", async () => {
    await create(local);
    expect(mocks.getParam).not.toHaveBeenCalled();
    expect(mocks.getSecret).not.toHaveBeenCalled();
    expect(spawnerCalls[0].env.DEMO_TOOLPACK_URL).toBeUndefined();
  });

  it.each([
    ["the toolpack URL", "param"],
    ["the signing secret", "secret"],
  ])(
    "is not configured (exit 3) when %s is missing — nothing spawns",
    async (_label, which) => {
      const { EnvNotConfiguredError } = await import("@portalai/cli-env");
      if (which === "param") {
        mocks.getParam.mockRejectedValue(
          Object.assign(new Error("Failed to read"), {
            cause: notFound("ParameterNotFound"),
          })
        );
      } else {
        mocks.getSecret.mockRejectedValue(
          Object.assign(new Error("Failed to read"), {
            cause: notFound("ResourceNotFoundException"),
          })
        );
      }
      await expect(create(appDev)).rejects.toBeInstanceOf(
        EnvNotConfiguredError
      );
      expect(spawner).not.toHaveBeenCalled();
    }
  );

  it("passes any other config read failure through unchanged", async () => {
    mocks.getParam.mockRejectedValue(new Error("throttled"));
    await expect(create(appDev)).rejects.toThrow("throttled");
    expect(spawner).not.toHaveBeenCalled();
  });

  it("an unknown owner is not-found (exit 8) and nothing spawns", async () => {
    const { AdminNotFoundError } = await import("../errors.js");
    mockStore.getUserByEmail.mockRejectedValue(
      new AdminNotFoundError("User owner@acme.test not found")
    );
    await expect(create(appDev)).rejects.toBeInstanceOf(AdminNotFoundError);
    expect(spawner).not.toHaveBeenCalled();
  });

  it("an unknown tier is not-found (exit 8) and nothing spawns", async () => {
    const { AdminNotFoundError } = await import("../errors.js");
    mockStore.getTier.mockRejectedValue(
      new AdminNotFoundError('Tier "nope" not found')
    );
    await expect(create(appDev, { tier: "nope" })).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
    expect(spawner).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name over 120 characters", { name: "x".repeat(121) }],
    ["a non-integer --rows", { rows: "1.5" }],
    ["a negative --rows", { rows: "-5" }],
    ["--rows over 10,000,000", { rows: "10000001" }],
  ])("%s is a usage error (exit 2) before the guard", async (_l, opts) => {
    const { AdminInvalidInputError } = await import("../errors.js");
    await expect(create(appDev, opts)).rejects.toBeInstanceOf(
      AdminInvalidInputError
    );
    expect(mocks.assertOperationAllowed).not.toHaveBeenCalled();
    expect(spawner).not.toHaveBeenCalled();
  });

  it("is guarded as a mutation: a refused guard spawns nothing", async () => {
    mocks.assertOperationAllowed.mockImplementation(() => {
      throw new EnvNotAuthorizedError("needs --yes --confirm-prod");
    });
    await expect(create(prod as never, {}, { yes: true })).rejects.toThrow(
      /confirm-prod/
    );
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(prod, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
    expect(mockStore.getUserByEmail).not.toHaveBeenCalled();
    expect(spawner).not.toHaveBeenCalled();
  });

  it("writes the audit line and prints the --rows / demo delete reminder to stderr", async () => {
    await create(appDev);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "demo create",
        operator: SUB,
        // ids/slugs only (common.ts audit rule), as org create records.
        args: {
          organizationId: "o-demo",
          name: "Acme demo",
          tier: "enterprise",
          rows: 10000,
        },
      })
    );
    expect(stderr).toContain("--rows");
    expect(stderr).toContain("portalai demo delete o-demo --env app-dev --yes");
  });

  it("demo delete is a mutation (allowed on prod with --yes --confirm-prod) over softDeleteDemoOrg", async () => {
    const { demoDelete } = await import("../commands/demo.js");
    mockStore.softDeleteDemoOrg.mockResolvedValue(undefined);
    const out = await demoDelete(prod as never, "o-demo", {
      yes: true,
      confirmProd: true,
    });
    expect(out).toEqual({ id: "o-demo", deleted: true });
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(prod, {
      destructive: false,
      confirmed: true,
      prodConfirmed: true,
    });
    expect(mockStore.softDeleteDemoOrg).toHaveBeenCalledWith("o-demo", SUB);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "demo delete",
        args: { orgId: "o-demo" },
      })
    );
  });

  it("demo delete refused by the guard touches nothing", async () => {
    const { demoDelete } = await import("../commands/demo.js");
    mocks.assertOperationAllowed.mockImplementation(() => {
      throw new EnvNotAuthorizedError("needs --confirm-prod");
    });
    await expect(
      demoDelete(prod as never, "o-demo", { yes: true })
    ).rejects.toThrow(/confirm-prod/);
    expect(mockStore.softDeleteDemoOrg).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe("member commands (email-resolved)", () => {
  it("member add resolves the email then adds by user id", async () => {
    mockStore.getUserByEmail.mockResolvedValue({ id: "u-9" });
    mockStore.addMember.mockResolvedValue(undefined);
    const out = await memberAdd(appDev, "o-1", "ben@portalsai.io", {
      yes: true,
    });
    expect(out).toEqual({ orgId: "o-1", userId: "u-9", added: true });
    expect(mockStore.addMember).toHaveBeenCalledWith("o-1", "u-9", SUB);
    const audit = mocks.recordAudit.mock.calls[0][0] as { args: unknown };
    expect(JSON.stringify(audit)).not.toContain(
      "ben@portalsai.io".split("@")[1] + "-row"
    );
    expect(audit).toMatchObject({ args: { orgId: "o-1", userId: "u-9" } });
  });

  it("member switch bumps the app's current-org selector", async () => {
    mockStore.getUserByEmail.mockResolvedValue({ id: "u-9" });
    mockStore.switchMember.mockResolvedValue(undefined);
    const out = await memberSwitch(appDev, "o-1", "ben@portalsai.io", {
      yes: true,
    });
    expect(out).toEqual({ orgId: "o-1", userId: "u-9", switched: true });
    expect(mockStore.switchMember).toHaveBeenCalledWith("o-1", "u-9", SUB);
  });
});
