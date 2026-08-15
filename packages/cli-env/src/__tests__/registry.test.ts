import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BUILTIN_ENVIRONMENTS,
  loadEnvironments,
  getEnvironment,
  secretsPrefix,
  ssmPrefix,
  clusterName,
  bastionExportName,
} from "../registry.js";
import { EnvNotConfiguredError } from "../errors.js";

// Point ~/.portalai at a fresh temp dir per test so override-file cases are
// hermetic (PORTALAI_HOME is the test/agent-friendly override of os.homedir()).
let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-env-test-"));
  process.env.PORTALAI_HOME = tmpDir;
});
afterEach(() => {
  delete process.env.PORTALAI_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const writeOverrides = (content: unknown) => {
  fs.writeFileSync(
    path.join(tmpDir, "environments.json"),
    typeof content === "string" ? content : JSON.stringify(content)
  );
};

describe("BUILTIN_ENVIRONMENTS", () => {
  it("local is a development env with no AWS config", () => {
    const local = BUILTIN_ENVIRONMENTS["local"];
    expect(local.kind).toBe("development");
    expect(local.aws).toBeNull();
    expect(local.apiBaseUrl).toBe("http://localhost:3001");
  });

  it("app-dev is staging and maps to the AWS env name 'dev'", () => {
    const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
    expect(appDev.kind).toBe("staging");
    expect(appDev.apiBaseUrl).toBe("https://api-dev.portalsai.io");
    expect(appDev.aws).toEqual({ region: "us-east-1", envName: "dev" });
  });

  // #384: prod is the environment the production guards were written for in
  // #194 and have never had. `kind` is the whole contract — every barrier in
  // guard.ts keys on it, never on the name.
  it("prod is production and maps to the AWS env name 'prod'", () => {
    const prod = BUILTIN_ENVIRONMENTS["prod"];
    expect(prod.kind).toBe("production");
    expect(prod.apiBaseUrl).toBe("https://api.portalsai.io");
    expect(prod.aws).toEqual({ region: "us-east-1", envName: "prod" });
  });
});

describe("AWS naming helpers (mirror api-cli.sh conventions)", () => {
  const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

  it("derives every AWS name from the AWS env name, not the display name", () => {
    expect(secretsPrefix(appDev)).toBe("portalai/dev");
    expect(ssmPrefix(appDev)).toBe("/portalai/dev");
    expect(clusterName(appDev)).toBe("portalai-dev");
    expect(bastionExportName(appDev)).toBe("dev-BastionInstanceId");
  });

  // #384: prod's AWS names come from the same formula, so nothing in the
  // CLI, the runbooks or the AWS_CLI_OPS naming table needs a prod branch.
  it("derives prod's names from the same formula", () => {
    const prod = BUILTIN_ENVIRONMENTS["prod"];
    expect(secretsPrefix(prod)).toBe("portalai/prod");
    expect(ssmPrefix(prod)).toBe("/portalai/prod");
    expect(clusterName(prod)).toBe("portalai-prod");
    expect(bastionExportName(prod)).toBe("prod-BastionInstanceId");
  });

  it("throws ENV_NOT_CONFIGURED for an env without AWS config", () => {
    const local = BUILTIN_ENVIRONMENTS["local"];
    for (const helper of [
      secretsPrefix,
      ssmPrefix,
      clusterName,
      bastionExportName,
    ]) {
      expect(() => helper(local)).toThrow(EnvNotConfiguredError);
    }
  });
});

describe("getEnvironment", () => {
  it("throws ENV_NOT_CONFIGURED for an unknown name, listing the known envs", () => {
    expect(() => getEnvironment("prood")).toThrow(EnvNotConfiguredError);
    try {
      getEnvironment("prood");
    } catch (err) {
      expect((err as Error).message).toContain("app-dev");
      expect((err as Error).message).toContain("local");
    }
  });
});

describe("override file (~/.portalai/environments.json)", () => {
  it("merges an override entry with kind FORCED to development", () => {
    writeOverrides({
      "scratch-db": {
        // A user may claim production here — the registry must not honor it.
        kind: "production",
        apiBaseUrl: "http://localhost:3999",
        aws: null,
      },
    });
    const envs = loadEnvironments();
    expect(envs["scratch-db"]).toEqual({
      name: "scratch-db",
      kind: "development",
      apiBaseUrl: "http://localhost:3999",
      aws: null,
    });
    // Built-ins are untouched.
    expect(envs["app-dev"].kind).toBe("staging");
  });

  it("rejects an override that shadows a built-in", () => {
    writeOverrides({
      "app-dev": { apiBaseUrl: "http://evil:1", aws: null },
    });
    expect(() => loadEnvironments()).toThrow(EnvNotConfiguredError);
    expect(() => loadEnvironments()).toThrow(/app-dev/);
  });

  // #384: this is what makes the production guards unbypassable. An override
  // has its kind FORCED to development, so a `prod` override that resolved
  // would run every production write with NO barrier — no --yes, no
  // --confirm-prod, destructive ops permitted. Refusing to shadow a built-in
  // is the only reason that attack doesn't exist, which is why the prod entry
  // has to live in code rather than in an operator's home directory.
  it("rejects an override that shadows prod — the guards' load-bearing rule", () => {
    writeOverrides({
      prod: { kind: "production", apiBaseUrl: "http://evil:1", aws: null },
    });
    expect(() => loadEnvironments()).toThrow(EnvNotConfiguredError);
    expect(() => loadEnvironments()).toThrow(/prod/);
  });

  it("rejects a malformed file, naming it", () => {
    writeOverrides("{ not json !!");
    expect(() => loadEnvironments()).toThrow(EnvNotConfiguredError);
    expect(() => loadEnvironments()).toThrow(/environments\.json/);
  });

  it("returns only built-ins when no override file exists", () => {
    const envs = loadEnvironments();
    expect(Object.keys(envs).sort()).toEqual(["app-dev", "local", "prod"]);
  });
});
