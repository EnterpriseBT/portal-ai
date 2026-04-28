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
  verifyState,
  STATE_TTL_MS,
} from "../../../utils/oauth-state.util.js";
import { decryptCredentials } from "../../../utils/crypto.util.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";

const { connectorDefinitions, connectorInstances } = schema;

const AUTH0_ID = "auth0|gsheets-test-user";
const TEST_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
const TEST_STATE_SECRET = crypto.randomBytes(32).toString("base64");

let originalEnv: {
  encryptionKey: string | undefined;
  stateSecret: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

beforeAll(() => {
  originalEnv = {
    encryptionKey: environment.ENCRYPTION_KEY,
    stateSecret: environment.OAUTH_STATE_SECRET,
    clientId: environment.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: environment.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: environment.GOOGLE_OAUTH_REDIRECT_URI,
  };
  environment.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  environment.OAUTH_STATE_SECRET = TEST_STATE_SECRET;
  environment.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  environment.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  environment.GOOGLE_OAUTH_REDIRECT_URI =
    "http://localhost:3001/api/connectors/google-sheets/callback";
});

afterAll(() => {
  environment.ENCRYPTION_KEY = originalEnv.encryptionKey;
  environment.OAUTH_STATE_SECRET = originalEnv.stateSecret;
  environment.GOOGLE_OAUTH_CLIENT_ID = originalEnv.clientId;
  environment.GOOGLE_OAUTH_CLIENT_SECRET = originalEnv.clientSecret;
  environment.GOOGLE_OAUTH_REDIRECT_URI = originalEnv.redirectUri;
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

// Hoisted refs the callback tests reuse to seed Google API responses. The
// exchange + userinfo paths are mocked; the URL builder isn't (slice-7 tests
// exercise that code path against the real implementation).
const exchangeCodeMock =
  jest.fn<
    (
      input: { code: string }
    ) => Promise<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope: string;
    }>
  >();
const fetchUserEmailMock = jest.fn<(token: string) => Promise<string>>();

const { GoogleAuthService } = await import(
  "../../../services/google-auth.service.js"
);
const originalExchange = GoogleAuthService.exchangeCode.bind(GoogleAuthService);
const originalFetchEmail =
  GoogleAuthService.fetchUserEmail.bind(GoogleAuthService);
GoogleAuthService.exchangeCode =
  exchangeCodeMock as unknown as typeof GoogleAuthService.exchangeCode;
GoogleAuthService.fetchUserEmail =
  fetchUserEmailMock as unknown as typeof GoogleAuthService.fetchUserEmail;

afterAll(() => {
  GoogleAuthService.exchangeCode = originalExchange;
  GoogleAuthService.fetchUserEmail = originalFetchEmail;
});

const { app } = await import("../../../app.js");

describe("Google Sheets Connector Router — POST /authorize", () => {
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

  it("returns 200 with a Google consent URL whose state binds to the JWT identity", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    const res = await request(app)
      .post("/api/connectors/google-sheets/authorize")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const url = new URL(res.body.payload.url);
    expect(url.host).toBe("accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(verifyState(state as string)).toEqual({ userId, organizationId });
  });

  it("returns 500 GOOGLE_OAUTH_NOT_CONFIGURED when GOOGLE_OAUTH_CLIENT_ID is empty", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
    const original = environment.GOOGLE_OAUTH_CLIENT_ID;
    environment.GOOGLE_OAUTH_CLIENT_ID = "";
    try {
      const res = await request(app)
        .post("/api/connectors/google-sheets/authorize")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.GOOGLE_OAUTH_NOT_CONFIGURED);
    } finally {
      environment.GOOGLE_OAUTH_CLIENT_ID = original;
    }
  });

  it("returns 500 GOOGLE_OAUTH_NOT_CONFIGURED when GOOGLE_OAUTH_REDIRECT_URI is empty", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
    const original = environment.GOOGLE_OAUTH_REDIRECT_URI;
    environment.GOOGLE_OAUTH_REDIRECT_URI = "";
    try {
      const res = await request(app)
        .post("/api/connectors/google-sheets/authorize")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe(ApiCode.GOOGLE_OAUTH_NOT_CONFIGURED);
    } finally {
      environment.GOOGLE_OAUTH_REDIRECT_URI = original;
    }
  });
});

// ── GET /callback ──────────────────────────────────────────────────

const now = Date.now();

function insertGoogleSheetsDefinition(
  db: ReturnType<typeof drizzle>
): Promise<string> {
  const id = crypto.randomUUID();
  return (db as ReturnType<typeof drizzle>)
    .insert(connectorDefinitions)
    .values({
      id,
      slug: "google-sheets",
      display: "Google Sheets",
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

describe("Google Sheets Connector Router — GET /callback", () => {
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
    fetchUserEmailMock.mockReset();
  });

  afterEach(async () => {
    await connection.end();
  });

  it("returns 400 GOOGLE_OAUTH_INVALID_STATE when state is malformed", async () => {
    await insertGoogleSheetsDefinition(db as ReturnType<typeof drizzle>);
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

    const res = await request(app)
      .get("/api/connectors/google-sheets/callback")
      .query({ code: "abc", state: "junk" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.GOOGLE_OAUTH_INVALID_STATE);
    expect(exchangeCodeMock).not.toHaveBeenCalled();
  });

  it("returns 400 GOOGLE_OAUTH_INVALID_STATE when state is expired", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertGoogleSheetsDefinition(db as ReturnType<typeof drizzle>);

    // Sign with a past timestamp so the verifier sees it as expired.
    const expiredState = signState(
      { userId, organizationId },
      { now: () => Date.now() - STATE_TTL_MS - 1000 }
    );

    const res = await request(app)
      .get("/api/connectors/google-sheets/callback")
      .query({ code: "abc", state: expiredState });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.GOOGLE_OAUTH_INVALID_STATE);
  });

  it("returns 502 GOOGLE_OAUTH_EXCHANGE_FAILED when token exchange fails (no DB write)", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertGoogleSheetsDefinition(db as ReturnType<typeof drizzle>);

    exchangeCodeMock.mockRejectedValueOnce(
      Object.assign(new Error("bad code"), {
        name: "GoogleAuthError",
        kind: "exchange_failed",
      })
    );
    const state = signState({ userId, organizationId });

    const res = await request(app)
      .get("/api/connectors/google-sheets/callback")
      .query({ code: "bad", state });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.GOOGLE_OAUTH_EXCHANGE_FAILED);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances);
    expect(rows).toHaveLength(0);
  });

  it("returns 502 GOOGLE_OAUTH_USERINFO_FAILED when fetchUserEmail fails (no DB write)", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertGoogleSheetsDefinition(db as ReturnType<typeof drizzle>);

    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/drive.readonly",
    });
    fetchUserEmailMock.mockRejectedValueOnce(
      Object.assign(new Error("userinfo failed"), {
        name: "GoogleAuthError",
        kind: "userinfo_failed",
      })
    );
    const state = signState({ userId, organizationId });

    const res = await request(app)
      .get("/api/connectors/google-sheets/callback")
      .query({ code: "ok", state });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.GOOGLE_OAUTH_USERINFO_FAILED);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances);
    expect(rows).toHaveLength(0);
  });

  it("creates a pending ConnectorInstance with encrypted credentials on the happy path", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertGoogleSheetsDefinition(db as ReturnType<typeof drizzle>);

    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "ya29.access",
      refreshToken: "1//refresh-token-A",
      expiresIn: 3599,
      scope:
        "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly",
    });
    fetchUserEmailMock.mockResolvedValueOnce("alice@example.com");
    const state = signState({ userId, organizationId });

    const res = await request(app)
      .get("/api/connectors/google-sheets/callback")
      .query({ code: "good-code", state });

    expect(res.status).toBe(200);
    // Slice 8 ships HTML — assert the new id appears in the body.
    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.organizationId, organizationId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("pending");
    expect(row.credentials).toBeTruthy();
    expect(res.text).toContain(row.id);

    const decrypted = decryptCredentials(row.credentials as string);
    expect(decrypted).toMatchObject({
      refresh_token: "1//refresh-token-A",
      googleAccountEmail: "alice@example.com",
    });
    expect(decrypted.scopes).toBeDefined();
    expect(Array.isArray(decrypted.scopes)).toBe(true);

    // Voiding the userId reference for lint — used implicitly in seed step.
    void userId;
  });

  it("re-auth for the same Google account updates the existing instance (no duplicate)", async () => {
    const { userId, organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    await insertGoogleSheetsDefinition(db as ReturnType<typeof drizzle>);

    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "ya29.first",
      refreshToken: "1//refresh-A",
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/drive.readonly",
    });
    fetchUserEmailMock.mockResolvedValueOnce("alice@example.com");
    const state1 = signState({ userId, organizationId });
    const res1 = await request(app)
      .get("/api/connectors/google-sheets/callback")
      .query({ code: "first", state: state1 });
    expect(res1.status).toBe(200);

    const rowsAfterFirst = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.organizationId, organizationId));
    expect(rowsAfterFirst).toHaveLength(1);
    const firstId = rowsAfterFirst[0]!.id;

    // Second auth for the SAME google account email → refresh-token rotates.
    exchangeCodeMock.mockResolvedValueOnce({
      accessToken: "ya29.second",
      refreshToken: "1//refresh-B",
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/drive.readonly",
    });
    fetchUserEmailMock.mockResolvedValueOnce("alice@example.com");
    const state2 = signState({ userId, organizationId });
    const res2 = await request(app)
      .get("/api/connectors/google-sheets/callback")
      .query({ code: "second", state: state2 });
    expect(res2.status).toBe(200);

    const rowsAfterSecond = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.organizationId, organizationId));
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]!.id).toBe(firstId);

    const decrypted = decryptCredentials(
      rowsAfterSecond[0]!.credentials as string
    );
    expect(decrypted.refresh_token).toBe("1//refresh-B");
    expect(res2.text).toContain(firstId);
  });
});
