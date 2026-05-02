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
import { eq } from "drizzle-orm";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { environment } from "../../../environment.js";
import {
  signState,
  STATE_TTL_MS,
  verifyState,
} from "../../../utils/oauth-state.util.js";
import { decryptCredentials } from "../../../utils/crypto.util.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";

const { connectorDefinitions, connectorInstances } = schema;

const AUTH0_ID = "auth0|microsoft-excel-test-user";
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
const TEST_STATE_SECRET = crypto.randomBytes(32).toString("base64");

let originalEnv: {
  encryptionKey: string | undefined;
  stateSecret: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
};

beforeAll(() => {
  originalEnv = {
    encryptionKey: environment.ENCRYPTION_KEY,
    stateSecret: environment.OAUTH_STATE_SECRET,
    clientId: environment.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: environment.MICROSOFT_OAUTH_CLIENT_SECRET,
    redirectUri: environment.MICROSOFT_OAUTH_REDIRECT_URI,
    tenant: environment.MICROSOFT_OAUTH_TENANT,
  };
  environment.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  environment.OAUTH_STATE_SECRET = TEST_STATE_SECRET;
  environment.MICROSOFT_OAUTH_CLIENT_ID = "test-client-id";
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = "test-client-secret";
  environment.MICROSOFT_OAUTH_REDIRECT_URI =
    "http://localhost:3001/api/connectors/microsoft-excel/callback";
  environment.MICROSOFT_OAUTH_TENANT = "common";
});

afterAll(() => {
  environment.ENCRYPTION_KEY = originalEnv.encryptionKey;
  environment.OAUTH_STATE_SECRET = originalEnv.stateSecret;
  environment.MICROSOFT_OAUTH_CLIENT_ID = originalEnv.clientId;
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = originalEnv.clientSecret;
  environment.MICROSOFT_OAUTH_REDIRECT_URI = originalEnv.redirectUri;
  environment.MICROSOFT_OAUTH_TENANT = originalEnv.tenant;
});

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
    next();
  },
}));

jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

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

const { MicrosoftAuthService } = await import(
  "../../../services/microsoft-auth.service.js"
);
const originalExchange = MicrosoftAuthService.exchangeCode.bind(
  MicrosoftAuthService
);
const originalFetchProfile = MicrosoftAuthService.fetchUserProfile.bind(
  MicrosoftAuthService
);
MicrosoftAuthService.exchangeCode =
  exchangeCodeMock as unknown as typeof MicrosoftAuthService.exchangeCode;
MicrosoftAuthService.fetchUserProfile =
  fetchUserProfileMock as unknown as typeof MicrosoftAuthService.fetchUserProfile;

afterAll(() => {
  MicrosoftAuthService.exchangeCode = originalExchange;
  MicrosoftAuthService.fetchUserProfile = originalFetchProfile;
});

const { app } = await import("../../../app.js");

const now = Date.now();

function makeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

function insertMicrosoftExcelDefinition(
  db: ReturnType<typeof drizzle>
): Promise<string> {
  const id = crypto.randomUUID();
  return db
    .insert(connectorDefinitions)
    .values({
      id,
      slug: "microsoft-excel",
      display: "Microsoft 365 Excel",
      category: "File-based",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { sync: true, read: true, write: false, push: false },
      isActive: false,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never)
    .then(() => id);
}

describe("Microsoft Excel Connector Router — POST /authorize", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("returns 200 with a Microsoft consent URL whose state binds to the JWT identity", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    const res = await request(app)
      .post("/api/connectors/microsoft-excel/authorize")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const url = new URL(res.body.payload.url);
    expect(url.host).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(verifyState(state as string)).toEqual({ userId, organizationId });
  });

  it("returns 500 MICROSOFT_OAUTH_NOT_CONFIGURED when client id is empty", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
    const original = environment.MICROSOFT_OAUTH_CLIENT_ID;
    environment.MICROSOFT_OAUTH_CLIENT_ID = "";
    try {
      const res = await request(app)
        .post("/api/connectors/microsoft-excel/authorize")
        .set("Authorization", "Bearer test-token");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe(ApiCode.MICROSOFT_OAUTH_NOT_CONFIGURED);
    } finally {
      environment.MICROSOFT_OAUTH_CLIENT_ID = original;
    }
  });
});

describe("Microsoft Excel Connector Router — GET /callback", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    exchangeCodeMock.mockReset();
    fetchUserProfileMock.mockReset();
  });

  afterEach(async () => {
    await connection.end();
  });

  it("returns 400 MICROSOFT_OAUTH_INVALID_STATE when state is malformed", async () => {
    await insertMicrosoftExcelDefinition(db as ReturnType<typeof drizzle>);
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

    const res = await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "abc", state: "junk" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.MICROSOFT_OAUTH_INVALID_STATE);
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("returns 400 MICROSOFT_OAUTH_INVALID_STATE when state is expired", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertMicrosoftExcelDefinition(db as ReturnType<typeof drizzle>);

    const expiredState = signState(
      { userId, organizationId },
      { now: () => Date.now() - STATE_TTL_MS - 1000 }
    );

    const res = await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "abc", state: expiredState });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.MICROSOFT_OAUTH_INVALID_STATE);
  });

  it("creates a pending ConnectorInstance with encrypted credentials including tenantId on first auth", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertMicrosoftExcelDefinition(db as ReturnType<typeof drizzle>);

    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-rt",
      idToken: makeIdToken({ tid: "tenant-A", oid: "alice-oid" }),
      expiresIn: 3599,
      scope:
        "openid profile email offline_access User.Read Files.Read.All",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice Smith",
      tenantId: "tenant-A",
    });
    const state = signState({ userId, organizationId });

    const res = await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "good-code", state });

    expect(res.status).toBe(200);
    expect(res.text).toContain("microsoft-excel-authorized");

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.organizationId, organizationId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("pending");
    expect(row.name).toBe("Microsoft 365 Excel (alice@contoso.com)");
    expect(row.config).toBeNull();
    expect(res.text).toContain(row.id);

    const decrypted = decryptCredentials(row.credentials as string);
    expect(decrypted).toMatchObject({
      refresh_token: "0.AX-rt",
      microsoftAccountUpn: "alice@contoso.com",
      microsoftAccountEmail: "alice@contoso.com",
      microsoftAccountDisplayName: "Alice Smith",
      tenantId: "tenant-A",
    });
    expect(Array.isArray(decrypted.scopes)).toBe(true);
  });

  it("updates the existing row for the same (org, tenantId, upn) — Reconnect", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertMicrosoftExcelDefinition(db as ReturnType<typeof drizzle>);

    // First callback: create the row.
    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "eyJ.access1",
      refreshToken: "0.AX-rt-1",
      idToken: makeIdToken({ tid: "tenant-A" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-A",
    });
    const state = signState({ userId, organizationId });
    await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "first", state });

    const firstRows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.organizationId, organizationId));
    expect(firstRows).toHaveLength(1);
    const firstRowId = firstRows[0]!.id;

    // Second callback for the same (org, tenant, upn): update in place.
    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "eyJ.access2",
      refreshToken: "0.AX-rt-2",
      idToken: makeIdToken({ tid: "tenant-A" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-A",
    });
    const state2 = signState({ userId, organizationId });
    const res = await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "second", state: state2 });

    expect(res.status).toBe(200);

    const secondRows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.organizationId, organizationId));
    expect(secondRows).toHaveLength(1);
    expect(secondRows[0]!.id).toBe(firstRowId);
    expect(secondRows[0]!.status).toBe("active");
    expect(secondRows[0]!.lastErrorMessage).toBeNull();
    const decrypted = decryptCredentials(
      secondRows[0]!.credentials as string
    );
    expect(decrypted.refresh_token).toBe("0.AX-rt-2");
  });

  it("creates a SEPARATE row for the same UPN under a different tenantId", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertMicrosoftExcelDefinition(db as ReturnType<typeof drizzle>);

    // First: tenant-A.
    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-rt-a",
      idToken: makeIdToken({ tid: "tenant-A" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-A",
    });
    await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "a", state: signState({ userId, organizationId }) });

    // Second: same UPN, tenant-B.
    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-rt-b",
      idToken: makeIdToken({ tid: "tenant-B" }),
      expiresIn: 3599,
      scope: "openid offline_access",
    });
    fetchUserProfileMock.mockResolvedValueOnce({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "tenant-B",
    });
    await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "b", state: signState({ userId, organizationId }) });

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.organizationId, organizationId));
    expect(rows).toHaveLength(2);
    const tenants = rows.map((r) =>
      decryptCredentials(r.credentials as string).tenantId
    );
    expect(new Set(tenants)).toEqual(new Set(["tenant-A", "tenant-B"]));
  });

  it("returns 502 MICROSOFT_OAUTH_EXCHANGE_FAILED when token exchange fails (no DB write)", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertMicrosoftExcelDefinition(db as ReturnType<typeof drizzle>);

    exchangeCodeMock.mockRejectedValueOnce(
      Object.assign(new Error("AADSTS70008"), {
        name: "MicrosoftAuthError",
        kind: "exchange_failed",
      })
    );
    const state = signState({ userId, organizationId });

    const res = await request(app)
      .get("/api/connectors/microsoft-excel/callback")
      .query({ code: "bad", state });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances);
    expect(rows).toHaveLength(0);
  });
});
