import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvInfraError,
  EnvNotAuthorizedError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

const mockGetSecret = mocks.getSecret;
const mockGetParam = mocks.getParam;

const { describeVars, listVars, getVar } = await import("../commands/vars.js");
const { CATALOG } = await import("../catalog.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

beforeEach(() => {
  resetCliEnvMocks();
});

describe("describeVars", () => {
  it("lists every catalog entry with its resolved path — and fetches NO values", async () => {
    const out = await describeVars(appDev);
    expect(out.env).toBe("app-dev");
    expect(out.region).toBe("us-east-1");
    expect(out.entries).toHaveLength(CATALOG.length);
    const db = out.entries.find((e) => e.key === "DATABASE_URL")!;
    expect(db).toMatchObject({ kind: "secret", path: "portalai/dev/database-url" });
    expect(mockGetSecret).not.toHaveBeenCalled();
    expect(mockGetParam).not.toHaveBeenCalled();
  });
});

describe("listVars", () => {
  it("masks secrets by default, shows SSM plain, and marks unset entries", async () => {
    mockGetSecret.mockImplementation(async (_d, name) => {
      if (name === "database-url") return "postgresql://u:p@h:5432/db";
      throw new EnvInfraError(`no secret ${name}`);
    });
    mockGetParam.mockImplementation(async (_d, name) => {
      if (name === "auth0-domain") return "portalsai-staging.us.auth0.com";
      throw new EnvInfraError(`no param ${name}`);
    });

    const { entries } = await listVars(appDev, {});
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));

    expect(byKey["DATABASE_URL"].masked).toBe(true);
    expect(byKey["DATABASE_URL"].value).toMatch(/^post…db \(len=\d+\)$/);
    expect(byKey["AUTH0_DOMAIN"]).toMatchObject({
      masked: false,
      value: "portalsai-staging.us.auth0.com",
    });
    expect(byKey["TAVILY_API_KEY"]).toMatchObject({
      masked: false,
      value: "(unset)",
    });
  });

  it("--unmask reveals secret values raw", async () => {
    mockGetSecret.mockResolvedValue("s3cret-value-long");
    mockGetParam.mockResolvedValue("x");
    const { entries } = await listVars(appDev, { unmask: true });
    const db = entries.find((e) => e.key === "DATABASE_URL")!;
    expect(db.value).toBe("s3cret-value-long");
    expect(db.masked).toBe(false);
  });

  it("propagates authorization failures instead of reporting (unset)", async () => {
    mockGetSecret.mockRejectedValue(new EnvNotAuthorizedError("run aws login"));
    mockGetParam.mockResolvedValue("x");
    await expect(listVars(appDev, {})).rejects.toBeInstanceOf(
      EnvNotAuthorizedError
    );
  });
});

describe("getVar", () => {
  it("returns the raw value (never masked) for an explicit single read", async () => {
    mockGetSecret.mockResolvedValue("tvly-raw-value");
    await expect(getVar(appDev, "TAVILY_API_KEY")).resolves.toEqual({
      key: "TAVILY_API_KEY",
      value: "tvly-raw-value",
    });
    expect(mockGetSecret).toHaveBeenCalledWith(appDev, "tavily-api-key");
  });

  it("unknown key → typed error naming vars describe", async () => {
    await expect(getVar(appDev, "NOPE")).rejects.toThrow(/vars describe/);
  });
});
