/**
 * End-to-end reconnect integration test for the microsoft-excel
 * connector.
 *
 * Spans:
 *   1. The access-token cache flipping `status: error` on
 *      `invalid_grant`.
 *   2. The OAuth callback finding the existing instance by
 *      `(org, tenantId, upn)` and resetting `status: active` +
 *      clearing `lastErrorMessage`.
 *
 * Mocks the network seam (MicrosoftAuthService.refreshAccessToken,
 * .exchangeCode, .fetchUserProfile); everything else (DB, encryption,
 * service orchestration) runs real.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "@jest/globals";
import crypto from "crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";
import { encryptCredentials } from "../../../utils/crypto.util.js";
import { signState } from "../../../utils/oauth-state.util.js";

const AUTH0_ID = "auth0|mexcel-reconnect-test-user";

const redisStore = new Map<string, string>();
jest.unstable_mockModule("../../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    set: async (key: string, value: string): Promise<"OK"> => {
      redisStore.set(key, value);
      return "OK";
    },
    get: async (key: string): Promise<string | null> =>
      redisStore.get(key) ?? null,
    del: async (key: string): Promise<number> => {
      const existed = redisStore.delete(key);
      return existed ? 1 : 0;
    },
  }),
  closeRedis: async () => undefined,
}));

const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
const TEST_STATE_SECRET = crypto.randomBytes(32).toString("base64");

const { environment } = await import("../../../environment.js");

let originalEnv: {
  encryptionKey: string | undefined;
  stateSecret: string;
  msClientId: string;
  msClientSecret: string;
  msRedirectUri: string;
};
beforeAll(() => {
  originalEnv = {
    encryptionKey: environment.ENCRYPTION_KEY,
    stateSecret: environment.OAUTH_STATE_SECRET,
    msClientId: environment.MICROSOFT_OAUTH_CLIENT_ID,
    msClientSecret: environment.MICROSOFT_OAUTH_CLIENT_SECRET,
    msRedirectUri: environment.MICROSOFT_OAUTH_REDIRECT_URI,
  };
  environment.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  environment.OAUTH_STATE_SECRET = TEST_STATE_SECRET;
  environment.MICROSOFT_OAUTH_CLIENT_ID = "test-client-id";
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = "test-client-secret";
  environment.MICROSOFT_OAUTH_REDIRECT_URI =
    "http://localhost:3001/api/connectors/microsoft-excel/callback";
});
afterAll(() => {
  environment.ENCRYPTION_KEY = originalEnv.encryptionKey;
  environment.OAUTH_STATE_SECRET = originalEnv.stateSecret;
  environment.MICROSOFT_OAUTH_CLIENT_ID = originalEnv.msClientId;
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = originalEnv.msClientSecret;
  environment.MICROSOFT_OAUTH_REDIRECT_URI = originalEnv.msRedirectUri;
});

const { MicrosoftAuthService, MicrosoftAuthError } = await import(
  "../../../services/microsoft-auth.service.js"
);
const refreshAccessTokenMock =
  jest.fn<typeof MicrosoftAuthService.refreshAccessToken>();
const exchangeCodeMock =
  jest.fn<typeof MicrosoftAuthService.exchangeCode>();
const fetchUserProfileMock =
  jest.fn<typeof MicrosoftAuthService.fetchUserProfile>();
MicrosoftAuthService.refreshAccessToken =
  refreshAccessTokenMock as unknown as typeof MicrosoftAuthService.refreshAccessToken;
MicrosoftAuthService.exchangeCode =
  exchangeCodeMock as unknown as typeof MicrosoftAuthService.exchangeCode;
MicrosoftAuthService.fetchUserProfile =
  fetchUserProfileMock as unknown as typeof MicrosoftAuthService.fetchUserProfile;

const { MicrosoftAccessTokenCacheService } = await import(
  "../../../services/microsoft-access-token-cache.service.js"
);
const { MicrosoftExcelConnectorService } = await import(
  "../../../services/microsoft-excel-connector.service.js"
);

const { connectorInstances, connectorDefinitions } = schema;
type Db = ReturnType<typeof drizzle>;

const now = Date.now();

function makeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("microsoft-excel reconnect — end-to-end", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let organizationId: string;
  let userId: string;
  let connectorDefinitionId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    redisStore.clear();
    refreshAccessTokenMock.mockReset();
    exchangeCodeMock.mockReset();
    fetchUserProfileMock.mockReset();
    MicrosoftAccessTokenCacheService.__resetInflightForTests();

    await teardownOrg(db);
    const seed = await seedUserAndOrg(db, AUTH0_ID);
    organizationId = seed.organizationId;
    userId = seed.userId;

    connectorDefinitionId = generateId();
    await db.insert(connectorDefinitions).values({
      id: connectorDefinitionId,
      slug: "microsoft-excel",
      display: "Microsoft 365 Excel",
      category: "File-based",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { sync: true, read: true, write: false, push: false },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  async function seedInstance(
    upn: string,
    tenantId: string,
    refreshToken: string
  ): Promise<string> {
    const id = generateId();
    await db.insert(connectorInstances).values({
      id,
      connectorDefinitionId,
      organizationId,
      name: `Microsoft 365 Excel (${upn})`,
      status: "active" as const,
      config: { driveItemId: "01ABC", name: "x.xlsx", fetchedAt: now },
      credentials: encryptCredentials({
        refresh_token: refreshToken,
        scopes: ["openid", "offline_access", "Files.Read.All"],
        microsoftAccountUpn: upn,
        microsoftAccountEmail: upn,
        microsoftAccountDisplayName: upn,
        tenantId,
        lastRefreshedAt: 0,
      }),
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  }

  it("revoke → flip status=error → callback heals → next refresh succeeds", async () => {
    const upn = "alice@contoso.com";
    const tenantId = "tenant-A";
    const instanceId = await seedInstance(upn, tenantId, "0.AX-REVOKED");

    // Step 1: refresh fails because Microsoft revoked the token.
    refreshAccessTokenMock.mockRejectedValueOnce(
      new MicrosoftAuthError("refresh_failed", "AADSTS70008: revoked")
    );
    await expect(
      MicrosoftAccessTokenCacheService.getOrRefresh(instanceId)
    ).rejects.toMatchObject({ kind: "refresh_failed" });

    // DB reflects status=error with the upstream message.
    const [errored] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instanceId));
    expect(errored?.status).toBe("error");
    expect(errored?.lastErrorMessage).toContain("AADSTS70008");

    // Step 2: user reconnects → callback finds the existing row and
    // updates it.
    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "eyJ.fresh-access",
      refreshToken: "0.AX-FRESH",
      idToken: makeIdToken({ tid: tenantId }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      upn,
      email: upn,
      displayName: "Alice",
      tenantId,
    });

    const callbackResult =
      await MicrosoftExcelConnectorService.handleCallback({
        code: "fresh-code",
        state: signState({ userId, organizationId }),
      });
    expect(callbackResult.connectorInstanceId).toBe(instanceId);

    // DB row reset to active.
    const [healed] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instanceId));
    expect(healed?.status).toBe("active");
    expect(healed?.lastErrorMessage).toBeNull();

    // Step 3: next refresh should succeed against the new refresh
    // token. Clear the in-process inflight Map so the new attempt
    // re-reads the DB.
    MicrosoftAccessTokenCacheService.__resetInflightForTests();
    refreshAccessTokenMock.mockResolvedValueOnce({
      accessToken: "eyJ.post-reconnect",
      refreshToken: "0.AX-ROTATED",
      expiresIn: 3599,
      scope: "openid offline_access",
    });

    const accessToken =
      await MicrosoftAccessTokenCacheService.getOrRefresh(instanceId);
    expect(accessToken).toBe("eyJ.post-reconnect");
    expect(refreshAccessTokenMock).toHaveBeenLastCalledWith("0.AX-FRESH");
  });

  it("reconnect under one tenant does NOT heal an instance with the same UPN under a different tenant", async () => {
    const upn = "alice@contoso.com";
    const tenantA = "tenant-A";
    const tenantB = "tenant-B";

    const instanceA = await seedInstance(upn, tenantA, "0.AX-A-OLD");
    const instanceB = await seedInstance(upn, tenantB, "0.AX-B-OLD");

    // Flip instance A to status=error.
    refreshAccessTokenMock.mockRejectedValueOnce(
      new MicrosoftAuthError("refresh_failed", "AADSTS70008: revoked-A")
    );
    await expect(
      MicrosoftAccessTokenCacheService.getOrRefresh(instanceA)
    ).rejects.toMatchObject({ kind: "refresh_failed" });

    // User reconnects under tenant B (e.g. they only have admin access
    // to that tenant, or they pick a different account at the consent
    // screen).
    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "eyJ.access-B",
      refreshToken: "0.AX-B-NEW",
      idToken: makeIdToken({ tid: tenantB }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      upn,
      email: upn,
      displayName: "Alice",
      tenantId: tenantB,
    });

    const result = await MicrosoftExcelConnectorService.handleCallback({
      code: "x",
      state: signState({ userId, organizationId }),
    });
    // The callback updated tenant-B's row, not tenant-A's.
    expect(result.connectorInstanceId).toBe(instanceB);

    const [a] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, instanceA));
    expect(a?.status).toBe("error");
    expect(a?.lastErrorMessage).toContain("AADSTS70008");
  });
});
