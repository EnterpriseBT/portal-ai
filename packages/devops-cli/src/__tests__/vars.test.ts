import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const { describeVars, listVars, getVar, setVar, applyVars, templateVars } =
  await import("../commands/vars.js");
const { CATALOG } = await import("../catalog.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

let tmpDir: string;
beforeEach(() => {
  resetCliEnvMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portalops-vars-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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

// ── Slice 2 — writes ─────────────────────────────────────────────────

describe("setVar", () => {
  it("writes a secret (guarded as a mutation, audited WITHOUT the value)", async () => {
    mocks.putSecret.mockResolvedValue({ created: false });
    const out = await setVar(appDev, "TAVILY_API_KEY", "tvly-new-secret", {
      yes: true,
    });
    expect(out).toEqual({ key: "TAVILY_API_KEY", updated: true, created: false });
    expect(mocks.putSecret).toHaveBeenCalledWith(
      appDev,
      "tavily-api-key",
      "tvly-new-secret"
    );
    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: false,
      confirmed: true,
      prodConfirmed: false,
    });
    const audit = mocks.recordAudit.mock.calls[0][0];
    expect(audit).toMatchObject({ env: "app-dev", command: "vars set" });
    expect(JSON.stringify(audit)).not.toContain("tvly-new-secret");
  });

  it("writes an SSM param with its catalog type", async () => {
    mocks.putParam.mockResolvedValue(undefined);
    const out = await setVar(appDev, "CORS_ORIGIN", "https://app-dev.portalsai.io", {
      yes: true,
    });
    expect(out).toEqual({ key: "CORS_ORIGIN", updated: true, created: false });
    expect(mocks.putParam).toHaveBeenCalledWith(
      appDev,
      "cors-origin",
      "https://app-dev.portalsai.io",
      "String"
    );
  });

  it("reads '-' from stdin and refuses an empty value before any guard/write", async () => {
    mocks.putSecret.mockResolvedValue({ created: false });
    await setVar(appDev, "TAVILY_API_KEY", "-", {
      yes: true,
      stdin: async () => "from-stdin\n",
    });
    expect(mocks.putSecret).toHaveBeenCalledWith(
      appDev,
      "tavily-api-key",
      "from-stdin"
    );

    mocks.putSecret.mockClear();
    mocks.assertOperationAllowed.mockClear();
    await expect(
      setVar(appDev, "TAVILY_API_KEY", "-", { yes: true, stdin: async () => "  " })
    ).rejects.toThrow(/empty value/i);
    expect(mocks.assertOperationAllowed).not.toHaveBeenCalled();
    expect(mocks.putSecret).not.toHaveBeenCalled();
  });
});

describe("applyVars", () => {
  const write = (content: string) => {
    const f = path.join(tmpDir, "vars.env");
    fs.writeFileSync(f, content);
    return f;
  };

  it("parses comments/blanks/quotes, validates, writes all, audits per key", async () => {
    mocks.putSecret.mockResolvedValue({ created: false });
    mocks.putParam.mockResolvedValue(undefined);
    const f = write(
      [
        "# comment",
        "",
        'TAVILY_API_KEY="tvly-quoted"',
        "CORS_ORIGIN='https://x'",
        "NAMESPACE=plain",
      ].join("\n")
    );
    const out = await applyVars(appDev, f, { yes: true });
    expect(out.applied.sort()).toEqual([
      "CORS_ORIGIN",
      "NAMESPACE",
      "TAVILY_API_KEY",
    ]);
    expect(mocks.putSecret).toHaveBeenCalledWith(appDev, "tavily-api-key", "tvly-quoted");
    expect(mocks.putParam).toHaveBeenCalledWith(appDev, "cors-origin", "https://x", "String");
    expect(mocks.recordAudit).toHaveBeenCalledTimes(3);
    expect(mocks.assertOperationAllowed).toHaveBeenCalledTimes(1); // guard once
  });

  it("aborts wholesale on one bad line — before ANY write — naming file:line", async () => {
    const f = write(["TAVILY_API_KEY=ok", "NOT_A_KEY=v"].join("\n"));
    await expect(applyVars(appDev, f, { yes: true })).rejects.toThrow(/:2/);
    expect(mocks.putSecret).not.toHaveBeenCalled();
    expect(mocks.putParam).not.toHaveBeenCalled();
  });
});

describe("templateVars", () => {
  it("writes a pre-filled 0600 file and refuses to overwrite", async () => {
    mockGetSecret.mockResolvedValue("secret-val-long-enough");
    mockGetParam.mockResolvedValue("param-val");
    const out = path.join(tmpDir, "cloud-vars.app-dev.env");

    const res = await templateVars(appDev, out);
    expect(res.path).toBe(out);
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    const content = fs.readFileSync(out, "utf8");
    expect(content).toContain("TAVILY_API_KEY=secret-val-long-enough");
    expect(content).toContain("AUTH0_DOMAIN=param-val");

    await expect(templateVars(appDev, out)).rejects.toThrow(/refusing/i);
  });
});
