import { jest } from "@jest/globals";

// ── Mock the AWS SDK clients (no live AWS in unit tests) ─────────────

const secretsSend = jest.fn<(cmd: unknown) => Promise<unknown>>();
const ssmSend = jest.fn<(cmd: unknown) => Promise<unknown>>();
const clientConfigs: unknown[] = [];

jest.unstable_mockModule("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    constructor(cfg: unknown) {
      clientConfigs.push(cfg);
    }
    send = secretsSend;
  },
  GetSecretValueCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

jest.unstable_mockModule("@aws-sdk/client-ssm", () => ({
  SSMClient: class {
    constructor(cfg: unknown) {
      clientConfigs.push(cfg);
    }
    send = ssmSend;
  },
  GetParameterCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

const { getSecret, getParam, getDatabaseUrl } = await import("../aws.js");
const { BUILTIN_ENVIRONMENTS } = await import("../registry.js");
const { EnvNotAuthorizedError, EnvInfraError, EnvNotConfiguredError } =
  await import("../errors.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];
const local = BUILTIN_ENVIRONMENTS["local"];

beforeEach(() => {
  secretsSend.mockReset();
  ssmSend.mockReset();
  clientConfigs.length = 0;
});

describe("getSecret", () => {
  it("reads exactly portalai/dev/<name> for app-dev, in the env's region", async () => {
    secretsSend.mockResolvedValue({ SecretString: "postgres://real" });
    await expect(getSecret(appDev, "database-url")).resolves.toBe(
      "postgres://real"
    );
    const cmd = secretsSend.mock.calls[0][0] as { input: { SecretId: string } };
    expect(cmd.input.SecretId).toBe("portalai/dev/database-url");
    expect(clientConfigs[0]).toMatchObject({ region: "us-east-1" });
  });

  it("maps a credential-shaped failure to ENV_NOT_AUTHORIZED", async () => {
    const err = new Error("The security token included in the request is expired");
    err.name = "ExpiredTokenException";
    secretsSend.mockRejectedValue(err);
    await expect(getSecret(appDev, "database-url")).rejects.toBeInstanceOf(
      EnvNotAuthorizedError
    );
  });

  it("maps a transport failure to ENV_INFRA_ERROR (cause preserved)", async () => {
    secretsSend.mockRejectedValue(new Error("socket hang up"));
    const p = getSecret(appDev, "database-url");
    await expect(p).rejects.toBeInstanceOf(EnvInfraError);
    await expect(p).rejects.toMatchObject({ code: "ENV_INFRA_ERROR" });
  });

  it("throws ENV_NOT_CONFIGURED for an env without AWS config", async () => {
    await expect(getSecret(local, "database-url")).rejects.toBeInstanceOf(
      EnvNotConfiguredError
    );
    expect(secretsSend).not.toHaveBeenCalled();
  });
});

describe("getParam", () => {
  it("reads exactly /portalai/dev/<name> for app-dev", async () => {
    ssmSend.mockResolvedValue({ Parameter: { Value: "dev-tenant.us.auth0.com" } });
    await expect(getParam(appDev, "auth0-domain")).resolves.toBe(
      "dev-tenant.us.auth0.com"
    );
    const cmd = ssmSend.mock.calls[0][0] as { input: { Name: string } };
    expect(cmd.input.Name).toBe("/portalai/dev/auth0-domain");
  });
});

describe("getDatabaseUrl", () => {
  it("is getSecret('database-url')", async () => {
    secretsSend.mockResolvedValue({ SecretString: "postgres://db" });
    await expect(getDatabaseUrl(appDev)).resolves.toBe("postgres://db");
    const cmd = secretsSend.mock.calls[0][0] as { input: { SecretId: string } };
    expect(cmd.input.SecretId).toBe("portalai/dev/database-url");
  });
});
