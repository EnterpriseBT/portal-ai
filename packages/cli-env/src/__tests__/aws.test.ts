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
  PutSecretValueCommand: class {
    constructor(public readonly input: unknown) {}
  },
  CreateSecretCommand: class {
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
  PutParameterCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

const { getSecret, getParam, getDatabaseUrl, putSecret, putParam } =
  await import("../aws.js");
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
  it("reads exactly /portalai/dev/<name> for app-dev, WITH decryption (parity with the bash)", async () => {
    ssmSend.mockResolvedValue({ Parameter: { Value: "dev-tenant.us.auth0.com" } });
    await expect(getParam(appDev, "auth0-domain")).resolves.toBe(
      "dev-tenant.us.auth0.com"
    );
    const cmd = ssmSend.mock.calls[0][0] as {
      input: { Name: string; WithDecryption?: boolean };
    };
    expect(cmd.input.Name).toBe("/portalai/dev/auth0-domain");
    expect(cmd.input.WithDecryption).toBe(true);
  });
});

describe("putSecret (#192)", () => {
  it("updates an existing secret via PutSecretValue → { created: false }", async () => {
    secretsSend.mockResolvedValue({});
    await expect(putSecret(appDev, "tavily-api-key", "tvly-new")).resolves.toEqual(
      { created: false }
    );
    const cmd = secretsSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: { SecretId: string; SecretString: string };
    };
    expect(cmd.constructor.name).toBe("PutSecretValueCommand");
    expect(cmd.input.SecretId).toBe("portalai/dev/tavily-api-key");
    expect(cmd.input.SecretString).toBe("tvly-new");
  });

  it("creates on ResourceNotFound → { created: true } (caller warns re: deploy ARNs)", async () => {
    const notFound = new Error("Secrets Manager can't find the specified secret.");
    notFound.name = "ResourceNotFoundException";
    secretsSend.mockRejectedValueOnce(notFound).mockResolvedValueOnce({});
    await expect(putSecret(appDev, "brand-new-key", "v")).resolves.toEqual({
      created: true,
    });
    const create = secretsSend.mock.calls[1][0] as {
      constructor: { name: string };
      input: { Name: string; SecretString: string };
    };
    expect(create.constructor.name).toBe("CreateSecretCommand");
    expect(create.input.Name).toBe("portalai/dev/brand-new-key");
  });

  it("maps write credential failures to ENV_NOT_AUTHORIZED", async () => {
    const err = new Error("denied");
    err.name = "AccessDeniedException";
    secretsSend.mockRejectedValue(err);
    await expect(putSecret(appDev, "tavily-api-key", "v")).rejects.toBeInstanceOf(
      EnvNotAuthorizedError
    );
  });
});

describe("putParam (#192)", () => {
  it("upserts with Overwrite + Type at the exact SSM path", async () => {
    ssmSend.mockResolvedValue({});
    await putParam(appDev, "auth0-cli-client-id", "abc123", "String");
    const cmd = ssmSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: { Name: string; Value: string; Type: string; Overwrite: boolean };
    };
    expect(cmd.constructor.name).toBe("PutParameterCommand");
    expect(cmd.input).toMatchObject({
      Name: "/portalai/dev/auth0-cli-client-id",
      Value: "abc123",
      Type: "String",
      Overwrite: true,
    });
  });

  it("defaults the type to String", async () => {
    ssmSend.mockResolvedValue({});
    await putParam(appDev, "namespace", "portal");
    const cmd = ssmSend.mock.calls[0][0] as { input: { Type: string } };
    expect(cmd.input.Type).toBe("String");
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
