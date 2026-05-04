import { jest, describe, it, expect, beforeEach, beforeAll, afterAll } from "@jest/globals";
import crypto from "crypto";

import { environment } from "../../environment.js";
import { signState } from "../../utils/oauth-state.util.js";

const TEST_STATE_SECRET = crypto.randomBytes(32).toString("base64");

let originalEnv: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
  stateSecret: string;
};

beforeAll(() => {
  originalEnv = {
    clientId: environment.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: environment.MICROSOFT_OAUTH_CLIENT_SECRET,
    redirectUri: environment.MICROSOFT_OAUTH_REDIRECT_URI,
    tenant: environment.MICROSOFT_OAUTH_TENANT,
    stateSecret: environment.OAUTH_STATE_SECRET,
  };
  environment.MICROSOFT_OAUTH_CLIENT_ID = "test-client-id";
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = "test-client-secret";
  environment.MICROSOFT_OAUTH_REDIRECT_URI =
    "http://localhost:3001/api/connectors/microsoft-excel/callback";
  environment.MICROSOFT_OAUTH_TENANT = "common";
  environment.OAUTH_STATE_SECRET = TEST_STATE_SECRET;
});

afterAll(() => {
  environment.MICROSOFT_OAUTH_CLIENT_ID = originalEnv.clientId;
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = originalEnv.clientSecret;
  environment.MICROSOFT_OAUTH_REDIRECT_URI = originalEnv.redirectUri;
  environment.MICROSOFT_OAUTH_TENANT = originalEnv.tenant;
  environment.OAUTH_STATE_SECRET = originalEnv.stateSecret;
});

// ── Mocks ──────────────────────────────────────────────────────────

class MockMicrosoftAuthError extends Error {
  override readonly name = "MicrosoftAuthError" as const;
  readonly kind: string;
  constructor(kind: string, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

const exchangeCodeMock =
  jest.fn<
    (
      input: { code: string }
    ) => Promise<{
      accessToken: string;
      refreshToken: string;
      idToken: string;
      expiresIn: number;
      scope: string;
    }>
  >();
const fetchUserProfileMock =
  jest.fn<
    (
      accessToken: string,
      tenantId: string
    ) => Promise<{
      upn: string;
      email: string | null;
      displayName: string;
      tenantId: string;
    }>
  >();

jest.unstable_mockModule("../../services/microsoft-auth.service.js", () => ({
  MicrosoftAuthService: {
    exchangeCode: exchangeCodeMock,
    fetchUserProfile: fetchUserProfileMock,
  },
  MicrosoftAuthError: MockMicrosoftAuthError,
  MICROSOFT_OAUTH_SCOPES: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "User.Read",
    "Files.Read.All",
  ],
}));

const findBySlugMock =
  jest.fn<(slug: string) => Promise<{ id: string; capabilityFlags: unknown } | undefined>>();
const findByOrgAndDefinitionMock =
  jest.fn<
    (
      orgId: string,
      definitionId: string
    ) => Promise<
      Array<{ id: string; credentials: unknown }>
    >
  >();
const createInstanceMock =
  jest.fn<(input: Record<string, unknown>) => Promise<{ id: string }>>();
const updateInstanceMock =
  jest.fn<(id: string, patch: Record<string, unknown>) => Promise<{ id: string } | undefined>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorDefinitions: { findBySlug: findBySlugMock },
      connectorInstances: {
        findByOrgAndDefinition: findByOrgAndDefinitionMock,
        create: createInstanceMock,
        update: updateInstanceMock,
      },
    },
  },
}));

const { MicrosoftExcelConnectorService } = await import(
  "../../services/microsoft-excel-connector.service.js"
);

// Decode a JWT-ish id_token. We use a hand-crafted token with a `tid`
// claim so the service's decoder pulls the tenant id without verifying
// the signature. (Microsoft's signature is verified upstream by the
// token endpoint; the call site only reads claims.)
function makeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

beforeEach(() => {
  exchangeCodeMock.mockReset();
  fetchUserProfileMock.mockReset();
  findBySlugMock.mockReset();
  findByOrgAndDefinitionMock.mockReset();
  createInstanceMock.mockReset();
  updateInstanceMock.mockReset();

  findBySlugMock.mockResolvedValue({
    id: "def-msft-1",
    capabilityFlags: { sync: true, read: true, write: false, push: false },
  });
});

describe("MicrosoftExcelConnectorService.handleCallback", () => {
  const userId = "user-1";
  const organizationId = "org-1";

  function validState() {
    return signState({ userId, organizationId });
  }

  it("throws ApiError(400, MICROSOFT_OAUTH_INVALID_STATE) on bad state", async () => {
    await expect(
      MicrosoftExcelConnectorService.handleCallback({
        code: "c",
        state: "not-a-real-state",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "MICROSOFT_OAUTH_INVALID_STATE",
    });
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("creates a pending instance with encrypted credentials including tenantId on first auth", async () => {
    exchangeCodeMock.mockResolvedValue({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-rt",
      idToken: makeIdToken({ tid: "tenant-A", oid: "alice-oid" }),
      expiresIn: 3599,
      scope: "openid offline_access Files.Read.All",
    });
    fetchUserProfileMock.mockResolvedValue({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-A",
    });
    findByOrgAndDefinitionMock.mockResolvedValue([]);
    createInstanceMock.mockResolvedValue({ id: "ci-new" });

    const result = await MicrosoftExcelConnectorService.handleCallback({
      code: "good",
      state: validState(),
    });

    expect(result.connectorInstanceId).toBe("ci-new");
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    const call = createInstanceMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.organizationId).toBe(organizationId);
    expect(call.connectorDefinitionId).toBe("def-msft-1");
    expect(call.status).toBe("pending");
    expect(call.config).toBeNull();
    expect(call.name).toBe("Microsoft 365 Excel (alice@contoso.com)");
    const credentials = call.credentials as Record<string, unknown>;
    expect(credentials.refresh_token).toBe("0.AX-rt");
    expect(credentials.microsoftAccountUpn).toBe("alice@contoso.com");
    expect(credentials.microsoftAccountEmail).toBe("alice@contoso.com");
    expect(credentials.microsoftAccountDisplayName).toBe("Alice");
    expect(credentials.tenantId).toBe("tenant-A");
    expect(credentials.scopes).toEqual([
      "openid",
      "offline_access",
      "Files.Read.All",
    ]);
    expect(call.enabledCapabilityFlags).toEqual({
      sync: true,
      read: true,
      write: false,
      push: false,
    });
  });

  it("updates the existing instance for the same (org, tenantId, upn) tuple — Reconnect path", async () => {
    exchangeCodeMock.mockResolvedValue({
      accessToken: "eyJ.access2",
      refreshToken: "0.AX-rt-2",
      idToken: makeIdToken({ tid: "tenant-A" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValue({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-A",
    });
    findByOrgAndDefinitionMock.mockResolvedValue([
      {
        id: "ci-existing",
        credentials: {
          refresh_token: "0.AX-rt-old",
          microsoftAccountUpn: "alice@contoso.com",
          tenantId: "tenant-A",
        },
      },
    ]);
    updateInstanceMock.mockResolvedValue({ id: "ci-existing" });

    const result = await MicrosoftExcelConnectorService.handleCallback({
      code: "good",
      state: validState(),
    });

    expect(result.connectorInstanceId).toBe("ci-existing");
    expect(createInstanceMock).not.toHaveBeenCalled();
    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
    const [calledId, patch] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe("ci-existing");
    expect(patch.status).toBe("active");
    expect(patch.lastErrorMessage).toBeNull();
    const updatedCreds = patch.credentials as Record<string, unknown>;
    expect(updatedCreds.refresh_token).toBe("0.AX-rt-2");
    expect(updatedCreds.tenantId).toBe("tenant-A");
  });

  it("creates a new row when the same UPN appears under a different tenantId", async () => {
    exchangeCodeMock.mockResolvedValue({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-rt",
      idToken: makeIdToken({ tid: "tenant-B" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValue({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-B",
    });
    // An instance for tenant-A already exists with the same UPN — must
    // NOT match for tenant-B.
    findByOrgAndDefinitionMock.mockResolvedValue([
      {
        id: "ci-existing-tenant-A",
        credentials: {
          refresh_token: "0.AX-old",
          microsoftAccountUpn: "alice@contoso.com",
          tenantId: "tenant-A",
        },
      },
    ]);
    createInstanceMock.mockResolvedValue({ id: "ci-new-tenant-B" });

    const result = await MicrosoftExcelConnectorService.handleCallback({
      code: "good",
      state: validState(),
    });

    expect(result.connectorInstanceId).toBe("ci-new-tenant-B");
    expect(createInstanceMock).toHaveBeenCalledTimes(1);
    expect(updateInstanceMock).not.toHaveBeenCalled();
  });

  it("throws 500 MICROSOFT_OAUTH_DEFINITION_NOT_FOUND when the connector definition is not seeded", async () => {
    findBySlugMock.mockResolvedValue(undefined);
    exchangeCodeMock.mockResolvedValue({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-rt",
      idToken: makeIdToken({ tid: "tenant-A" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValue({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-A",
    });
    await expect(
      MicrosoftExcelConnectorService.handleCallback({
        code: "good",
        state: validState(),
      })
    ).rejects.toMatchObject({
      status: 500,
      code: "MICROSOFT_OAUTH_DEFINITION_NOT_FOUND",
    });
  });

  it("propagates exchange failures as 502 MICROSOFT_OAUTH_EXCHANGE_FAILED", async () => {
    exchangeCodeMock.mockRejectedValue(
      new MockMicrosoftAuthError("exchange_failed", "AADSTS700016")
    );
    await expect(
      MicrosoftExcelConnectorService.handleCallback({
        code: "bad",
        state: validState(),
      })
    ).rejects.toMatchObject({
      status: 502,
      code: "MICROSOFT_OAUTH_EXCHANGE_FAILED",
    });
  });

  it("propagates missing-refresh-token as 502 MICROSOFT_OAUTH_NO_REFRESH_TOKEN", async () => {
    exchangeCodeMock.mockRejectedValue(
      new MockMicrosoftAuthError("no_refresh_token", "missing offline_access")
    );
    await expect(
      MicrosoftExcelConnectorService.handleCallback({
        code: "bad",
        state: validState(),
      })
    ).rejects.toMatchObject({
      status: 502,
      code: "MICROSOFT_OAUTH_NO_REFRESH_TOKEN",
    });
  });

  it("propagates Graph /me failures as 502 MICROSOFT_OAUTH_USERINFO_FAILED", async () => {
    exchangeCodeMock.mockResolvedValue({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-rt",
      idToken: makeIdToken({ tid: "tenant-A" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockRejectedValue(
      new MockMicrosoftAuthError("userinfo_failed", "401 Unauthorized")
    );
    await expect(
      MicrosoftExcelConnectorService.handleCallback({
        code: "good",
        state: validState(),
      })
    ).rejects.toMatchObject({
      status: 502,
      code: "MICROSOFT_OAUTH_USERINFO_FAILED",
    });
  });
});
