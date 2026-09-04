import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvInfraError,
  type MockEnvDef,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

const { localProvision, E2E_FIXTURE_ORG_NAME, ensureDemoTier } =
  await import("../commands/local.js");
const { TierAlreadyExistsError } = await import("../commands/tier.js");
import type { LocalProvisionDeps } from "../commands/local.js";

type RunScript = NonNullable<LocalProvisionDeps["runScript"]>;
type Seed = NonNullable<LocalProvisionDeps["seed"]>;
type Apply = NonNullable<LocalProvisionDeps["apply"]>;
type DemoTier = NonNullable<LocalProvisionDeps["demoTier"]>;

const local = BUILTIN_ENVIRONMENTS["local"];
const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

const SEED_RESULT = { via: "local", script: "db:seed" } as const;
const APPLY_RESULT = {
  dryRun: false,
  changes: [
    { slug: "plus", action: "insert", fields: {}, stripePriceId: "price_1" },
    { slug: "standard", action: "noop", fields: {}, stripePriceId: null },
  ],
  unmanaged: [],
};

const missingPrices = () =>
  Object.assign(new Error("No Stripe price found for lookup key(s): pro"), {
    code: "TIER_APPLY_MISSING_PRICES",
  });

let runScript: jest.MockedFunction<RunScript>;
let seed: jest.MockedFunction<Seed>;
let apply: jest.MockedFunction<Apply>;
let demoTier: jest.MockedFunction<DemoTier>;
const deps = (): LocalProvisionDeps => ({ runScript, seed, apply, demoTier });

beforeEach(() => {
  resetCliEnvMocks();
  runScript = jest.fn<RunScript>().mockResolvedValue("");
  seed = jest.fn<Seed>().mockResolvedValue(SEED_RESULT);
  apply = jest.fn<Apply>().mockResolvedValue(APPLY_RESULT as never);
  demoTier = jest
    .fn<DemoTier>()
    .mockResolvedValue({ slug: "demo", action: "insert" });
});

describe("localProvision — composition", () => {
  it("runs migrate → seed → tier-apply in order, reporting each ok", async () => {
    const order: string[] = [];
    runScript.mockImplementation(async (_def, script) => {
      order.push(script);
      return "";
    });
    seed.mockImplementation(async () => {
      order.push("seed");
      return SEED_RESULT;
    });
    apply.mockImplementation(async () => {
      order.push("apply");
      return APPLY_RESULT as never;
    });

    const out = await localProvision(local, {}, deps());

    expect(order).toEqual(["db:migrate", "seed", "apply"]);
    expect(out.steps.map((s) => [s.name, s.status])).toEqual([
      ["migrate", "ok"],
      ["seed", "ok"],
      ["tier-apply", "ok"],
      ["demo-tier", "ok"],
      ["e2e-org", "skipped"],
    ]);
    expect(out.steps[1].result).toEqual(SEED_RESULT);
    expect(out.steps[2].result).toEqual(APPLY_RESULT);
    expect(out.steps[3].result).toEqual({ slug: "demo", action: "insert" });
  });

  it("delegates, never reimplements: seed gets the opts + script runner, apply gets the flags", async () => {
    await localProvision(local, { yes: true }, deps());
    expect(seed).toHaveBeenCalledWith(
      local,
      expect.objectContaining({ yes: true }),
      runScript
    );
    expect(apply).toHaveBeenCalledWith(local, {
      yes: true,
      confirmProd: undefined,
    });
  });

  it("guards once as a mutation (a confirmation no-op on local's kind)", async () => {
    await localProvision(local, { yes: true }, deps());
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(local, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
  });

  it("refuses any env but local — deployed envs are CI/deploy-owned", async () => {
    await expect(
      localProvision(appDev as MockEnvDef as never, {}, deps())
    ).rejects.toThrow(/only supports --env local/);
    expect(runScript).not.toHaveBeenCalled();
  });

  it("audits the invocation with per-step statuses", async () => {
    await localProvision(local, {}, deps());
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "local provision",
        args: {
          steps: [
            { name: "migrate", status: "ok" },
            { name: "seed", status: "ok" },
            { name: "tier-apply", status: "ok" },
            { name: "demo-tier", status: "ok" },
            { name: "e2e-org", status: "skipped" },
          ],
          e2eOrg: null,
        },
      })
    );
  });
});

describe("localProvision — the e2e-org step", () => {
  it("seeds the fixture org via db:seed:org when an email is passed", async () => {
    const out = await localProvision(
      local,
      { e2eOrgEmail: "e2e@example.com" },
      deps()
    );
    expect(runScript).toHaveBeenCalledWith(local, "db:seed:org", [
      "--name",
      E2E_FIXTURE_ORG_NAME,
      "--member-email",
      "e2e@example.com",
    ]);
    expect(out.steps[4]).toEqual({
      name: "e2e-org",
      status: "ok",
      result: {
        script: "db:seed:org",
        orgName: E2E_FIXTURE_ORG_NAME,
        memberEmail: "e2e@example.com",
      },
    });
  });

  it("reports skipped (with the reason) when the flag is omitted", async () => {
    const out = await localProvision(local, {}, deps());
    expect(out.steps[4]).toEqual({
      name: "e2e-org",
      status: "skipped",
      result: { reason: "--e2e-org not passed" },
    });
    expect(runScript).not.toHaveBeenCalledWith(
      local,
      "db:seed:org",
      expect.anything()
    );
  });

  it("a failing db:seed:org (user never logged in) keeps the earlier steps' results", async () => {
    runScript.mockImplementation(async (_def, script) => {
      if (script === "db:seed:org") {
        throw new EnvInfraError(
          "db:seed:org failed (exit 1): User e2e@example.com not found"
        );
      }
      return "";
    });

    const out = await localProvision(
      local,
      { e2eOrgEmail: "e2e@example.com" },
      deps()
    );

    expect(out.steps.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "failed",
    ]);
    expect(out.steps[4].error).toEqual({
      code: "ENV_INFRA_ERROR",
      message: expect.stringContaining("not found") as never,
    });
  });
});

describe("localProvision — stop-on-failure", () => {
  it("a failed migrate runs nothing else and surfaces the step error", async () => {
    runScript.mockRejectedValue(
      new EnvInfraError("db:migrate failed (exit 1): boom")
    );

    const out = await localProvision(
      local,
      { e2eOrgEmail: "e2e@example.com" },
      deps()
    );

    expect(out.steps).toEqual([
      {
        name: "migrate",
        status: "failed",
        error: {
          code: "ENV_INFRA_ERROR",
          message: "db:migrate failed (exit 1): boom",
        },
      },
    ]);
    expect(seed).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a fail-closed tier apply keeps migrate + seed results and never reaches e2e-org", async () => {
    apply.mockRejectedValue(missingPrices());

    const out = await localProvision(
      local,
      { e2eOrgEmail: "e2e@example.com" },
      deps()
    );

    expect(out.steps.map((s) => [s.name, s.status])).toEqual([
      ["migrate", "ok"],
      ["seed", "ok"],
      ["tier-apply", "failed"],
    ]);
    expect(out.steps[2].error?.code).toBe("TIER_APPLY_MISSING_PRICES");
    expect(out.steps[1].result).toEqual(SEED_RESULT);
    expect(runScript).not.toHaveBeenCalledWith(
      local,
      "db:seed:org",
      expect.anything()
    );
  });

  it("still audits an invocation that failed partway", async () => {
    apply.mockRejectedValue(missingPrices());
    await localProvision(local, {}, deps());
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "local provision",
        args: expect.objectContaining({
          steps: [
            { name: "migrate", status: "ok" },
            { name: "seed", status: "ok" },
            { name: "tier-apply", status: "failed" },
          ],
        }),
      })
    );
  });
});

describe("localProvision — the demo-tier step (#511)", () => {
  it("runs after tier-apply and reports the create action", async () => {
    demoTier.mockResolvedValue({ slug: "demo", action: "insert" });
    const out = await localProvision(local, {}, deps());
    expect(demoTier).toHaveBeenCalledWith(local, {
      yes: undefined,
      confirmProd: undefined,
    });
    const step = out.steps.find((s) => s.name === "demo-tier");
    expect(step).toMatchObject({ status: "ok", result: { action: "insert" } });
  });

  it("a failed demo-tier stops before e2e-org", async () => {
    demoTier.mockRejectedValue(new EnvInfraError("demo tier boom"));
    const out = await localProvision(
      local,
      { e2eOrgEmail: "e2e@example.com" },
      deps()
    );
    expect(out.steps.map((s) => [s.name, s.status])).toEqual([
      ["migrate", "ok"],
      ["seed", "ok"],
      ["tier-apply", "ok"],
      ["demo-tier", "failed"],
    ]);
    expect(runScript).not.toHaveBeenCalledWith(
      local,
      "db:seed:org",
      expect.anything()
    );
  });
});

describe("ensureDemoTier — idempotency (#511)", () => {
  it("creates the demo tier with the unlimited/contact posture", async () => {
    const create = jest.fn(async () => ({ slug: "demo", action: "insert" }));
    const r = await ensureDemoTier(local, { yes: true }, create as never);
    expect(r).toEqual({ slug: "demo", action: "insert" });
    expect(create).toHaveBeenCalledWith(
      local,
      expect.objectContaining({
        slug: "demo",
        displayName: "Demo",
        cta: "contact",
      }),
      { yes: true }
    );
  });

  it("reports exists (no-op) when the slug already exists", async () => {
    const create = jest.fn(async () => {
      throw new TierAlreadyExistsError("demo");
    });
    const r = await ensureDemoTier(local, {}, create as never);
    expect(r).toEqual({ slug: "demo", action: "exists" });
  });

  it("rethrows any other error", async () => {
    const create = jest.fn(async () => {
      throw new Error("db down");
    });
    await expect(ensureDemoTier(local, {}, create as never)).rejects.toThrow(
      "db down"
    );
  });
});
