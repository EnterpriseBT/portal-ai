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

const { GoogleAccessTokenCacheService } = await import(
  "../../../services/google-access-token-cache.service.js"
);
const getOrRefreshMock = jest.fn<(id: string) => Promise<string>>();
const originalGetOrRefresh = GoogleAccessTokenCacheService.getOrRefresh.bind(
  GoogleAccessTokenCacheService
);
GoogleAccessTokenCacheService.getOrRefresh =
  getOrRefreshMock as unknown as typeof GoogleAccessTokenCacheService.getOrRefresh;

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<typeof fetch>();

afterAll(() => {
  GoogleAuthService.exchangeCode = originalExchange;
  GoogleAuthService.fetchUserEmail = originalFetchEmail;
  GoogleAccessTokenCacheService.getOrRefresh = originalGetOrRefresh;
  globalThis.fetch = originalFetch;
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

// ── GET /sheets ────────────────────────────────────────────────────

function mockDriveFetch({
  status = 200,
  body = {},
}: {
  status?: number;
  body?: unknown;
}): globalThis.Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as unknown as globalThis.Response;
}

async function insertGoogleSheetsInstance(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  definitionId: string,
  email: string
): Promise<string> {
  const { encryptCredentials } = await import("../../../utils/crypto.util.js");
  const id = crypto.randomUUID();
  await db.insert(connectorInstances).values({
    id,
    connectorDefinitionId: definitionId,
    organizationId,
    name: `Google Sheets (${email})`,
    status: "pending",
    config: null,
    credentials: encryptCredentials({
      refresh_token: "1//refresh-token",
      scopes: ["drive.readonly"],
      googleAccountEmail: email,
    }),
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);
  return id;
}

describe("Google Sheets Connector Router — GET /sheets", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);

    fetchMock.mockReset();
    getOrRefreshMock.mockReset();
    getOrRefreshMock.mockResolvedValue("ya29.access");
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    await connection.end();
    globalThis.fetch = originalFetch;
  });

  it("returns 400 GOOGLE_SHEETS_INVALID_INSTANCE_ID when connectorInstanceId is missing", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
    const res = await request(app)
      .get("/api/connectors/google-sheets/sheets")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.GOOGLE_SHEETS_INVALID_INSTANCE_ID);
  });

  it("returns 404 CONNECTOR_INSTANCE_NOT_FOUND when the id doesn't exist", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
    const res = await request(app)
      .get("/api/connectors/google-sheets/sheets?connectorInstanceId=nonexistent")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
  });

  it("returns 403 when the instance belongs to a different organization", async () => {
    const { organizationId: ourOrg } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    // Insert an instance under a DIFFERENT org id.
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      crypto.randomUUID(),
      definitionId,
      "stranger@example.com"
    );
    void ourOrg;
    const res = await request(app)
      .get(
        `/api/connectors/google-sheets/sheets?connectorInstanceId=${id}`
      )
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(403);
  });

  it("returns 200 with mapped items + nextPageToken on the happy path", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );

    fetchMock.mockResolvedValueOnce(
      mockDriveFetch({
        body: {
          files: [
            {
              id: "sheet-1",
              name: "Q3 Forecast",
              modifiedTime: "2026-04-29T10:00:00Z",
              owners: [{ emailAddress: "alice@example.com" }],
            },
            {
              id: "sheet-2",
              name: "Headcount",
              modifiedTime: "2026-04-28T10:00:00Z",
              owners: [{ emailAddress: "alice@example.com" }],
            },
          ],
          nextPageToken: "page-2",
        },
      })
    );

    const res = await request(app)
      .get(
        `/api/connectors/google-sheets/sheets?connectorInstanceId=${id}&search=forecast`
      )
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.items).toHaveLength(2);
    expect(res.body.payload.items[0]).toEqual({
      spreadsheetId: "sheet-1",
      name: "Q3 Forecast",
      modifiedTime: "2026-04-29T10:00:00Z",
      ownerEmail: "alice@example.com",
    });
    expect(res.body.payload.nextPageToken).toBe("page-2");
    expect(getOrRefreshMock).toHaveBeenCalledWith(id);
    // Verify the upstream URL carried the search filter.
    const calledUrl = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    const calledQ = new URL(calledUrl).searchParams.get("q") ?? "";
    expect(calledQ).toContain("name contains 'forecast'");
  });

  it("returns 502 GOOGLE_OAUTH_REFRESH_FAILED when refresh_token is revoked", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );

    getOrRefreshMock.mockRejectedValueOnce(
      Object.assign(new Error("Token has been expired"), {
        name: "GoogleAuthError",
        kind: "refresh_failed",
      })
    );

    const res = await request(app)
      .get(`/api/connectors/google-sheets/sheets?connectorInstanceId=${id}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.GOOGLE_OAUTH_REFRESH_FAILED);
  });

  it("returns 502 GOOGLE_SHEETS_LIST_FAILED on a Drive 4xx", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );

    fetchMock.mockResolvedValueOnce(
      mockDriveFetch({
        status: 403,
        body: { error: { message: "Insufficient Permission" } },
      })
    );

    const res = await request(app)
      .get(`/api/connectors/google-sheets/sheets?connectorInstanceId=${id}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.GOOGLE_SHEETS_LIST_FAILED);
  });
});

// ── POST /instances/:id/select-sheet ───────────────────────────────

function buildSheetsApiResponse({
  title,
  sheets,
}: {
  title: string;
  sheets: { name: string; rows: number; cols: number; cell?: { value: string } }[];
}) {
  return {
    properties: { title },
    sheets: sheets.map((s) => ({
      properties: {
        title: s.name,
        gridProperties: { rowCount: s.rows, columnCount: s.cols },
      },
      data: [
        {
          startRow: 0,
          startColumn: 0,
          rowData: s.cell
            ? [
                {
                  values: [
                    {
                      effectiveValue: { stringValue: s.cell.value },
                      formattedValue: s.cell.value,
                    },
                  ],
                },
              ]
            : [],
        },
      ],
    })),
  };
}

describe("Google Sheets Connector Router — POST /instances/:id/select-sheet", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    fetchMock.mockReset();
    getOrRefreshMock.mockReset();
    getOrRefreshMock.mockResolvedValue("ya29.access");
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    await connection.end();
    globalThis.fetch = originalFetch;
  });

  it("returns 400 GOOGLE_SHEETS_INVALID_PAYLOAD when spreadsheetId is missing", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );
    const res = await request(app)
      .post(`/api/connectors/google-sheets/instances/${id}/select-sheet`)
      .set("Authorization", "Bearer test-token")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.GOOGLE_SHEETS_INVALID_PAYLOAD);
  });

  it("returns 404 when the instance doesn't exist", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
    const res = await request(app)
      .post(
        "/api/connectors/google-sheets/instances/missing-id/select-sheet"
      )
      .set("Authorization", "Bearer test-token")
      .send({ spreadsheetId: "abc" });
    expect(res.status).toBe(404);
  });

  it("returns 502 GOOGLE_SHEETS_FETCH_FAILED on Sheets API 4xx (no DB or cache write)", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );

    fetchMock.mockResolvedValueOnce(
      mockDriveFetch({
        status: 404,
        body: { error: { message: "Requested entity was not found" } },
      })
    );

    const res = await request(app)
      .post(`/api/connectors/google-sheets/instances/${id}/select-sheet`)
      .set("Authorization", "Bearer test-token")
      .send({ spreadsheetId: "missing-spreadsheet" });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(ApiCode.GOOGLE_SHEETS_FETCH_FAILED);

    const after = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id));
    expect(after[0]?.config).toBeNull();
  });

  it("happy path: fetches small sheet, caches it, updates instance.config, returns inline preview", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );

    fetchMock.mockResolvedValueOnce(
      mockDriveFetch({
        body: buildSheetsApiResponse({
          title: "Q3 Forecast",
          sheets: [
            {
              name: "Forecast",
              rows: 1,
              cols: 1,
              cell: { value: "alpha" },
            },
          ],
        }),
      })
    );

    const res = await request(app)
      .post(`/api/connectors/google-sheets/instances/${id}/select-sheet`)
      .set("Authorization", "Bearer test-token")
      .send({ spreadsheetId: "1abcXYZ" });

    expect(res.status).toBe(200);
    expect(res.body.payload.sheets).toHaveLength(1);
    expect(res.body.payload.sheets[0].name).toBe("Forecast");
    // Inline cell present (small sheet under FILE_UPLOAD_INLINE_CELLS_MAX).
    expect(res.body.payload.sheets[0].cells[0][0]).toBe("alpha");
    expect(res.body.payload.sliced).toBeUndefined();

    // Verify upstream URL used the spreadsheets.get path.
    const calledUrl = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    expect(calledUrl).toContain(
      "https://sheets.googleapis.com/v4/spreadsheets/1abcXYZ"
    );
    expect(calledUrl).toContain("includeGridData=true");

    // instance.config updated.
    const after = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id));
    const cfg = after[0]?.config as Record<string, unknown>;
    expect(cfg.spreadsheetId).toBe("1abcXYZ");
    expect(cfg.title).toBe("Q3 Forecast");
    expect(typeof cfg.fetchedAt).toBe("number");
  });

  it("re-select-sheet overwrites instance.config (no stale spreadsheetId leaks)", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );

    fetchMock
      .mockResolvedValueOnce(
        mockDriveFetch({
          body: buildSheetsApiResponse({
            title: "First Workbook",
            sheets: [
              { name: "S", rows: 1, cols: 1, cell: { value: "x" } },
            ],
          }),
        })
      )
      .mockResolvedValueOnce(
        mockDriveFetch({
          body: buildSheetsApiResponse({
            title: "Second Workbook",
            sheets: [
              { name: "T", rows: 1, cols: 1, cell: { value: "y" } },
            ],
          }),
        })
      );

    await request(app)
      .post(`/api/connectors/google-sheets/instances/${id}/select-sheet`)
      .set("Authorization", "Bearer test-token")
      .send({ spreadsheetId: "first-id" });
    await request(app)
      .post(`/api/connectors/google-sheets/instances/${id}/select-sheet`)
      .set("Authorization", "Bearer test-token")
      .send({ spreadsheetId: "second-id" });

    const after = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id));
    const cfg = after[0]?.config as Record<string, unknown>;
    expect(cfg.spreadsheetId).toBe("second-id");
    expect(cfg.title).toBe("Second Workbook");
  });
});

// ── GET /instances/:id/sheet-slice ─────────────────────────────────

async function selectSmallSheet(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  email: string,
  cellValue = "alpha",
  dims: { rows: number; cols: number } = { rows: 1, cols: 1 }
): Promise<{ instanceId: string }> {
  const definitionId = await insertGoogleSheetsDefinition(db);
  const instanceId = await insertGoogleSheetsInstance(
    db,
    organizationId,
    definitionId,
    email
  );
  fetchMock.mockResolvedValueOnce(
    mockDriveFetch({
      body: buildSheetsApiResponse({
        title: "Small Workbook",
        sheets: [
          {
            name: "Forecast",
            rows: dims.rows,
            cols: dims.cols,
            cell: { value: cellValue },
          },
        ],
      }),
    })
  );
  await request(app)
    .post(
      `/api/connectors/google-sheets/instances/${instanceId}/select-sheet`
    )
    .set("Authorization", "Bearer test-token")
    .send({ spreadsheetId: "1abcXYZ" });
  return { instanceId };
}

describe("Google Sheets Connector Router — GET /instances/:id/sheet-slice", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    fetchMock.mockReset();
    getOrRefreshMock.mockReset();
    getOrRefreshMock.mockResolvedValue("ya29.access");
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    await connection.end();
    globalThis.fetch = originalFetch;
  });

  it("returns 404 when the instance doesn't exist", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
    const res = await request(app)
      .get("/api/connectors/google-sheets/instances/missing/sheet-slice")
      .set("Authorization", "Bearer test-token")
      .query({
        sheetId: "sheet_0_forecast",
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 1,
      });
    expect(res.status).toBe(404);
  });

  it("returns 404 FILE_UPLOAD_SESSION_NOT_FOUND-equivalent on cache miss (instance never selected a sheet)", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const definitionId = await insertGoogleSheetsDefinition(
      db as ReturnType<typeof drizzle>
    );
    const id = await insertGoogleSheetsInstance(
      db as ReturnType<typeof drizzle>,
      organizationId,
      definitionId,
      "alice@example.com"
    );

    const res = await request(app)
      .get(
        `/api/connectors/google-sheets/instances/${id}/sheet-slice`
      )
      .set("Authorization", "Bearer test-token")
      .query({
        sheetId: "sheet_0_forecast",
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 1,
      });
    expect(res.status).toBe(404);
  });

  it("returns 400 when query parameters are missing or malformed", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const { instanceId } = await selectSmallSheet(
      db as ReturnType<typeof drizzle>,
      organizationId,
      "alice@example.com"
    );

    const res = await request(app)
      .get(
        `/api/connectors/google-sheets/instances/${instanceId}/sheet-slice`
      )
      .set("Authorization", "Bearer test-token")
      .query({ sheetId: "sheet_0_forecast" }); // missing row/col
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.GOOGLE_SHEETS_INVALID_PAYLOAD);
  });

  it("returns 400 FILE_UPLOAD_SLICE_TOO_LARGE when the rectangle exceeds the cap", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const { instanceId } = await selectSmallSheet(
      db as ReturnType<typeof drizzle>,
      organizationId,
      "alice@example.com",
      "x",
      { rows: 1000, cols: 1000 } // declared dims big enough that the request survives clamping
    );

    const res = await request(app)
      .get(
        `/api/connectors/google-sheets/instances/${instanceId}/sheet-slice`
      )
      .set("Authorization", "Bearer test-token")
      .query({
        sheetId: "sheet_0_forecast",
        rowStart: 0,
        rowEnd: 1000,
        colStart: 0,
        colEnd: 1000, // 1M cells > FILE_UPLOAD_SLICE_CELLS_MAX (50k default)
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_SLICE_TOO_LARGE);
  });

  it("happy path: returns the requested rectangle from the cached workbook", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const { instanceId } = await selectSmallSheet(
      db as ReturnType<typeof drizzle>,
      organizationId,
      "alice@example.com",
      "hello"
    );

    const res = await request(app)
      .get(
        `/api/connectors/google-sheets/instances/${instanceId}/sheet-slice`
      )
      .set("Authorization", "Bearer test-token")
      .query({
        sheetId: "sheet_0_forecast",
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({
      cells: [["hello"]],
      rowStart: 0,
      colStart: 0,
    });
  });
});
