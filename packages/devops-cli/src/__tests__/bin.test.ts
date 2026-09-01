import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  EnvConfirmationRequiredError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

// local provision (#490): the composition has its own suite (local.test.ts);
// here the mock isolates the bin's wiring — flag parsing, the env gate, the
// e2e-org email resolution, and failed-step → exit-code mapping.
const localProvisionMock =
  jest.fn<(def: unknown, opts: unknown) => Promise<unknown>>();
jest.unstable_mockModule("../commands/local.js", () => ({
  localProvision: localProvisionMock,
}));

const { runCli } = await import("../bin.js");

let out = "";
let err = "";
let outSpy: ReturnType<typeof jest.spyOn>;
let errSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  resetCliEnvMocks();
  out = "";
  err = "";
  outSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
    s: string
  ) => {
    out += s;
    return true;
  }) as never);
  errSpy = jest.spyOn(process.stderr, "write").mockImplementation(((
    s: string
  ) => {
    err += s;
    return true;
  }) as never);
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe("runCli — the agent contract", () => {
  it("missing --env is a usage error → exit 2 (no implicit environment, ever)", async () => {
    const code = await runCli(["vars", "describe"]);
    expect(code).toBe(2);
  });

  it("unknown env → exit 3 with the --json error envelope on stdout", async () => {
    const code = await runCli(["vars", "describe", "--env", "nope", "--json"]);
    expect(code).toBe(3);
    const parsed = JSON.parse(out.trim());
    expect(parsed.error.code).toBe("ENV_NOT_CONFIGURED");
  });

  it("guard denial maps to exit 5", async () => {
    mocks.assertOperationAllowed.mockImplementation(() => {
      throw new EnvConfirmationRequiredError("needs --yes");
    });
    const code = await runCli([
      "vars",
      "set",
      "TAVILY_API_KEY",
      "v",
      "--env",
      "app-dev",
    ]);
    expect(code).toBe(5);
  });

  it("banner goes to stderr; --json payload alone on stdout", async () => {
    const code = await runCli([
      "vars",
      "describe",
      "--env",
      "app-dev",
      "--json",
    ]);
    expect(code).toBe(0);
    expect(err).toContain("[env: app-dev (staging)]");
    const parsed = JSON.parse(out.trim());
    expect(parsed.env).toBe("app-dev");
    expect(parsed.entries.length).toBeGreaterThan(10);
    expect(out).not.toContain("[env:");
  });
});

describe("local provision (#490)", () => {
  const ENV_KEY = "E2E_AUTH0_USERNAME";
  let savedEmail: string | undefined;

  const okSteps = () => ({
    steps: [
      { name: "migrate", status: "ok", result: { script: "db:migrate" } },
      {
        name: "seed",
        status: "ok",
        result: { via: "local", script: "db:seed" },
      },
      {
        name: "tier-apply",
        status: "ok",
        result: { dryRun: false, changes: [], unmanaged: [] },
      },
      {
        name: "e2e-org",
        status: "skipped",
        result: { reason: "--e2e-org not passed" },
      },
    ],
  });

  beforeEach(() => {
    savedEmail = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    localProvisionMock.mockReset().mockResolvedValue(okSteps());
  });
  afterEach(() => {
    if (savedEmail === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEmail;
  });

  it("--env app-dev is a usage error (exit 2) before anything runs", async () => {
    const code = await runCli(["local", "provision", "--env", "app-dev"]);
    expect(code).toBe(2);
    expect(localProvisionMock).not.toHaveBeenCalled();
    expect(err).not.toContain("[env:"); // no banner — no env was resolved
  });

  it("happy path: exit 0, --json steps payload alone on stdout", async () => {
    const code = await runCli([
      "local",
      "provision",
      "--env",
      "local",
      "--yes",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim());
    expect(parsed.steps.map((s: { name: string }) => s.name)).toEqual([
      "migrate",
      "seed",
      "tier-apply",
      "e2e-org",
    ]);
    expect(localProvisionMock.mock.calls[0][1]).toEqual({
      yes: true,
      confirmProd: undefined,
      e2eOrgEmail: undefined,
    });
  });

  it("a failed step maps to its exit code with the payload still on stdout", async () => {
    localProvisionMock.mockResolvedValue({
      steps: [
        { name: "migrate", status: "ok", result: { script: "db:migrate" } },
        {
          name: "seed",
          status: "ok",
          result: { via: "local", script: "db:seed" },
        },
        {
          name: "tier-apply",
          status: "failed",
          error: {
            code: "TIER_APPLY_MISSING_PRICES",
            message: "No Stripe price found for lookup key(s): pro",
          },
        },
      ],
    });
    const code = await runCli([
      "local",
      "provision",
      "--env",
      "local",
      "--json",
    ]);
    expect(code).toBe(8);
    const parsed = JSON.parse(out.trim());
    expect(parsed.steps).toHaveLength(3); // earlier results survive
    expect(parsed.steps[2].error.code).toBe("TIER_APPLY_MISSING_PRICES");
  });

  it("explicit --e2e-org email passes through verbatim", async () => {
    process.env[ENV_KEY] = "fromenv@example.com";
    const code = await runCli([
      "local",
      "provision",
      "--env",
      "local",
      "--e2e-org",
      "explicit@example.com",
    ]);
    expect(code).toBe(0);
    expect(localProvisionMock.mock.calls[0][1]).toMatchObject({
      e2eOrgEmail: "explicit@example.com",
    });
  });

  it("bare --e2e-org defaults the email from E2E_AUTH0_USERNAME", async () => {
    process.env[ENV_KEY] = "fromenv@example.com";
    const code = await runCli([
      "local",
      "provision",
      "--env",
      "local",
      "--e2e-org",
    ]);
    expect(code).toBe(0);
    expect(localProvisionMock.mock.calls[0][1]).toMatchObject({
      e2eOrgEmail: "fromenv@example.com",
    });
  });

  it("bare --e2e-org with the var unset is a usage error (exit 2), nothing run", async () => {
    const code = await runCli([
      "local",
      "provision",
      "--env",
      "local",
      "--e2e-org",
    ]);
    expect(code).toBe(2);
    expect(localProvisionMock).not.toHaveBeenCalled();
    expect(err).toContain("E2E_AUTH0_USERNAME");
  });
});
