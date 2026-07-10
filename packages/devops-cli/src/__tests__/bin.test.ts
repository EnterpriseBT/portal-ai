import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  EnvConfirmationRequiredError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

const { runCli } = await import("../bin.js");

let out = "";
let err = "";
let outSpy: ReturnType<typeof jest.spyOn>;
let errSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  resetCliEnvMocks();
  out = "";
  err = "";
  outSpy = jest.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
    out += s;
    return true;
  }) as never);
  errSpy = jest.spyOn(process.stderr, "write").mockImplementation(((s: string) => {
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
    const code = await runCli(["vars", "describe", "--env", "app-dev", "--json"]);
    expect(code).toBe(0);
    expect(err).toContain("[env: app-dev (staging)]");
    const parsed = JSON.parse(out.trim());
    expect(parsed.env).toBe("app-dev");
    expect(parsed.entries.length).toBeGreaterThan(10);
    expect(out).not.toContain("[env:");
  });
});
