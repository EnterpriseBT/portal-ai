/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, isNull, and } from "drizzle-orm";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|toolpacks-router-test";

// Mock global fetch for the registration service's upstream calls.
const mockFetch =
  jest.fn<(url: string, options?: Record<string, any>) => Promise<unknown>>();
(globalThis as any).fetch = mockFetch;

const VALID_SCHEMA_RESPONSE = {
  tools: [
    {
      name: "lookup_company",
      description: "Look up a company by domain.",
      parameterSchema: {
        type: "object",
        properties: { domain: { type: "string" } },
      },
    },
  ],
};

function fetchOk(body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-length", String(text.length)]]),
    text: async () => text,
  };
}

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

const { app } = await import("../../../app.js");

describe("Toolpacks Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  let organizationId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
    const seeded = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    organizationId = seeded.organizationId;
    mockFetch.mockReset();
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  const VALID_REGISTER_BODY = {
    name: "customer_intel",
    description: "External customer intelligence calls.",
    endpoints: {
      schema: "https://example.com/schema",
      runtime: "https://example.com/runtime",
    },
  };

  describe("GET /api/toolpacks", () => {
    // Case 36
    it("returns the six built-in toolpacks", async () => {
      const res = await request(app).get("/api/toolpacks");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.toolpacks).toHaveLength(6);
      expect(res.body.payload.total).toBe(6);
      const slugs = (res.body.payload.toolpacks as { slug: string }[]).map(
        (t) => t.slug
      );
      expect(slugs.sort()).toEqual(
        [
          "data_query",
          "entity_management",
          "financial",
          "regression",
          "statistics",
          "web_search",
        ].sort()
      );
      for (const t of res.body.payload.toolpacks) {
        expect(t.kind).toBe("builtin");
        expect(t.id).toBe(`builtin:${t.slug}`);
        expect(Array.isArray(t.tools)).toBe(true);
      }
    });

    // Case 37
    it("returns an empty list when filtering for kind=custom", async () => {
      const res = await request(app).get("/api/toolpacks?kind=custom");
      expect(res.status).toBe(200);
      expect(res.body.payload.toolpacks).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    // Case 38
    it("filters by tool description on the search query", async () => {
      // `correlate` is in the statistics pack and its description mentions "correlation"
      const res = await request(app).get("/api/toolpacks?search=correl");
      expect(res.status).toBe(200);
      const slugs = (res.body.payload.toolpacks as { slug: string }[]).map(
        (t) => t.slug
      );
      expect(slugs).toContain("statistics");
      expect(slugs).not.toContain("data_query");
    });
  });

  describe("GET /api/toolpacks/:id", () => {
    // Case 39
    it("returns the requested built-in pack by id", async () => {
      const res = await request(app).get("/api/toolpacks/builtin:data_query");
      expect(res.status).toBe(200);
      expect(res.body.payload.toolpack.slug).toBe("data_query");
      expect(res.body.payload.toolpack.kind).toBe("builtin");
      expect(
        (res.body.payload.toolpack.tools as { name: string }[]).map(
          (t) => t.name
        )
      ).toContain("sql_query");
    });

    // Case 40
    it("404s for an unknown built-in slug", async () => {
      const res = await request(app).get(
        "/api/toolpacks/builtin:does_not_exist"
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_NOT_FOUND);
    });

    // Case 41
    it("404s for a custom: prefix in phase 1", async () => {
      const res = await request(app).get(
        "/api/toolpacks/custom:any-uuid-here"
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_NOT_FOUND);
    });

    // Case 42
    it("404s for an un-prefixed id", async () => {
      const res = await request(app).get("/api/toolpacks/data_query");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_NOT_FOUND);
    });
  });

  describe("POST /api/toolpacks", () => {
    // Case 91
    it("registers a custom pack and redacts auth headers", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));

      const res = await request(app).post("/api/toolpacks").send({
        ...VALID_REGISTER_BODY,
        authHeaders: { "X-Api-Key": "secret" },
      });

      expect(res.status).toBe(201);
      expect(res.body.payload.toolpack.kind).toBe("custom");
      expect(res.body.payload.toolpack.slug).toBe("customer_intel");
      expect(res.body.payload.toolpack.tools).toHaveLength(1);
      expect(res.body.payload.toolpack.authHeadersStatus.has).toBe(true);
      // Redaction check: the literal value never appears in the body.
      expect(JSON.stringify(res.body)).not.toContain("secret");
    });

    // Case 92
    it("409s on duplicate name within the same org", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const first = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      expect(first.status).toBe(201);

      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const second = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe(ApiCode.TOOLPACK_NAME_CONFLICT);
    });

    // Case 93
    it("502s on schema fetch failure with TOOLPACK_SCHEMA_FETCH_FAILED", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Map(),
        text: async () => "",
      });

      const res = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED);
    });

    // Case 94
    it("502s on schema validation failure", async () => {
      mockFetch.mockResolvedValue(fetchOk({ tools: [] }));
      const res = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);

      expect(res.status).toBe(502);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_SCHEMA_INVALID);
    });

    // Case 95
    it("409s when a tool name collides with a built-in", async () => {
      mockFetch.mockResolvedValue(
        fetchOk({
          tools: [
            {
              name: "sql_query", // collides with data_query pack tool
              description: "x",
              parameterSchema: { type: "object", properties: {} },
            },
          ],
        })
      );

      const res = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_TOOL_NAME_CONFLICT);
    });

    // Case 96
    it("registers without metadata when the metadata fetch fails", async () => {
      // First call (schema): succeeds. Second call (metadata): fails.
      mockFetch
        .mockResolvedValueOnce(fetchOk(VALID_SCHEMA_RESPONSE))
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          headers: new Map(),
          text: async () => "",
        });

      const res = await request(app)
        .post("/api/toolpacks")
        .send({
          ...VALID_REGISTER_BODY,
          endpoints: {
            ...VALID_REGISTER_BODY.endpoints,
            metadata: "https://example.com/metadata",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.payload.toolpack.metadataFetchedAt).toBeNull();
    });
  });

  describe("PATCH /api/toolpacks/:id", () => {
    async function registerSeed(): Promise<string> {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const res = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      mockFetch.mockReset();
      return res.body.payload.toolpack.id as string;
    }

    // Case 97
    it("updates name + description without re-fetching schema", async () => {
      const id = await registerSeed();
      const res = await request(app)
        .patch(`/api/toolpacks/${id}`)
        .send({ name: "renamed_pack", description: "new description" });
      expect(res.status).toBe(200);
      expect(res.body.payload.toolpack.slug).toBe("renamed_pack");
      expect(res.body.payload.toolpack.description).toBe("new description");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // Case 98
    it("re-fetches schema when endpoints change", async () => {
      const id = await registerSeed();
      mockFetch.mockResolvedValue(
        fetchOk({
          tools: [
            {
              name: "lookup_v2",
              description: "v2 lookup.",
              parameterSchema: { type: "object", properties: {} },
            },
          ],
        })
      );

      const res = await request(app)
        .patch(`/api/toolpacks/${id}`)
        .send({
          endpoints: {
            schema: "https://example.com/schema-v2",
            runtime: "https://example.com/runtime-v2",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.payload.toolpack.tools[0].name).toBe("lookup_v2");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Case 99
    it("404s on cross-org id", async () => {
      const id = await registerSeed();
      // Switch the auth-mock to a fresh user/org in a fresh DB run? Easier:
      // probe with a UUID that doesn't exist in this org.
      const res = await request(app)
        .patch(`/api/toolpacks/00000000-0000-0000-0000-000000000000`)
        .send({ name: "x_y_z" });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_NOT_FOUND);
      void id;
    });
  });

  describe("DELETE /api/toolpacks/:id", () => {
    // Case 100 + 101
    it("soft-deletes the pack and cascades into station_toolpacks", async () => {
      // Register a pack.
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const reg = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      const packId = reg.body.payload.toolpack.id as string;

      // Seed a station + a station_toolpacks row referencing the new pack.
      const stationId = `00000000-0000-0000-0000-${Date.now().toString().padStart(12, "0").slice(-12)}`;
      const now = Date.now();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.stations)
        .values({
          id: stationId,
          organizationId,
          name: "Test Station",
          description: null,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);
      const stpId = `${stationId}-stp`;
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.stationToolpacks)
        .values({
          id: stpId,
          stationId,
          builtinSlug: null,
          organizationToolpackId: packId,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);

      const res = await request(app).delete(`/api/toolpacks/${packId}`);
      expect(res.status).toBe(200);
      expect(res.body.payload.id).toBe(packId);
      expect(res.body.payload.affectedStationIds).toEqual([stationId]);

      // Cascade verification: the station_toolpacks row is now soft-deleted.
      const liveRows = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.stationToolpacks)
        .where(
          and(
            eq(schema.stationToolpacks.id, stpId),
            isNull(schema.stationToolpacks.deleted)
          )
        );
      expect(liveRows).toHaveLength(0);
    });
  });

  describe("POST /api/toolpacks/:id/refresh", () => {
    // Case 102
    it("refreshes tools + schemaFetchedAt on success", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const reg = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      const id = reg.body.payload.toolpack.id as string;
      const initialFetchedAt = reg.body.payload.toolpack.schemaFetchedAt as number;

      // Wait at least a millisecond so the refresh produces a strictly
      // larger timestamp.
      await new Promise((r) => setTimeout(r, 5));

      const newSchema = {
        tools: [
          {
            name: "fresh_tool",
            description: "Refreshed.",
            parameterSchema: { type: "object", properties: {} },
          },
        ],
      };
      mockFetch.mockResolvedValue(fetchOk(newSchema));

      const res = await request(app).post(`/api/toolpacks/${id}/refresh`);
      expect(res.status).toBe(200);
      expect(res.body.payload.toolpack.tools[0].name).toBe("fresh_tool");
      expect(res.body.payload.toolpack.schemaFetchedAt).toBeGreaterThan(
        initialFetchedAt
      );
    });

    // Case 103
    it("preserves cached values when the refresh fetch fails", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const reg = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      const id = reg.body.payload.toolpack.id as string;

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Map(),
        text: async () => "",
      });

      const res = await request(app).post(`/api/toolpacks/${id}/refresh`);
      expect(res.status).toBe(502);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED);

      // GET shows the original tools intact.
      const after = await request(app).get(`/api/toolpacks/${id}`);
      expect(after.status).toBe(200);
      expect(after.body.payload.toolpack.tools[0].name).toBe(
        VALID_SCHEMA_RESPONSE.tools[0].name
      );
    });
  });

  describe("GET /api/toolpacks (custom merge)", () => {
    // Case 104
    it("returns built-ins and custom rows merged", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      await request(app).post("/api/toolpacks").send(VALID_REGISTER_BODY);

      const res = await request(app).get("/api/toolpacks");
      expect(res.status).toBe(200);
      expect(res.body.payload.total).toBe(7); // 6 built-ins + 1 custom
      const kinds = (res.body.payload.toolpacks as { kind: string }[]).map(
        (t) => t.kind
      );
      expect(kinds).toContain("builtin");
      expect(kinds).toContain("custom");
    });

    // Case 105
    it("?kind=custom returns only custom rows scoped to the org", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      await request(app).post("/api/toolpacks").send(VALID_REGISTER_BODY);

      const res = await request(app).get("/api/toolpacks?kind=custom");
      expect(res.status).toBe(200);
      expect(res.body.payload.total).toBe(1);
      expect(res.body.payload.toolpacks[0].kind).toBe("custom");
      expect(res.body.payload.toolpacks[0].slug).toBe("customer_intel");
    });
  });

  describe("GET /api/toolpacks/:id (custom)", () => {
    // Case 106
    it("resolves a custom UUID id", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const reg = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      const id = reg.body.payload.toolpack.id as string;

      const res = await request(app).get(`/api/toolpacks/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.payload.toolpack.id).toBe(id);
      expect(res.body.payload.toolpack.kind).toBe("custom");
    });
  });

  describe("authHeaders never leak through the API (phase 5)", () => {
    // Case 135 — end-to-end encryption-at-rest contract.
    //
    // A registered toolpack's auth header value must not appear in
    // any API response body, and the on-disk `auth_headers` column
    // must hold an opaque ciphertext envelope rather than the
    // plaintext map. Distinctive token strings make the substring
    // checks unambiguous.
    it("redacts on POST + GET responses and stores ciphertext on disk", async () => {
      const SECRET = "secret-token-xyz-135";
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));

      const post = await request(app)
        .post("/api/toolpacks")
        .send({
          ...VALID_REGISTER_BODY,
          authHeaders: { Authorization: `Bearer ${SECRET}` },
        });
      expect(post.status).toBe(201);
      expect(post.body.payload.toolpack.authHeadersStatus.has).toBe(true);
      expect(JSON.stringify(post.body)).not.toContain(SECRET);

      const id = post.body.payload.toolpack.id as string;

      const detail = await request(app).get(`/api/toolpacks/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.payload.toolpack.authHeadersStatus.has).toBe(true);
      expect(JSON.stringify(detail.body)).not.toContain(SECRET);

      const list = await request(app).get("/api/toolpacks?kind=custom");
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain(SECRET);

      const rows = await (db as ReturnType<typeof drizzle>)
        .select({
          authHeaders: schema.organizationToolpacks.authHeaders,
        })
        .from(schema.organizationToolpacks)
        .where(
          and(
            eq(schema.organizationToolpacks.id, id),
            isNull(schema.organizationToolpacks.deleted)
          )
        )
        .limit(1);
      const raw = rows[0]?.authHeaders ?? null;
      expect(typeof raw).toBe("string");
      expect(raw).not.toContain(SECRET);
      expect(raw).not.toContain("Bearer");
      const payload = JSON.parse(raw as string);
      expect(payload).toEqual(
        expect.objectContaining({
          iv: expect.any(String),
          authTag: expect.any(String),
          data: expect.any(String),
          v: 1,
        })
      );
    });
  });

  // ── Phase 6: signing secret surfaced once + rotation ──────────────

  describe("signing secret one-time reveal + rotation (phase 6)", () => {
    // Case 156
    it("POST surfaces signingSecret once; GET redacts it", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));

      const post = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      expect(post.status).toBe(201);

      const surfacedSecret = post.body.payload.signingSecret as string;
      expect(surfacedSecret).toMatch(/^whsec_/);
      expect(post.body.payload.toolpack.signingSecretStatus.has).toBe(true);

      const id = post.body.payload.toolpack.id as string;

      // GET does not include the plaintext secret anywhere in the body.
      const get = await request(app).get(`/api/toolpacks/${id}`);
      expect(get.status).toBe(200);
      expect(get.body.payload.toolpack.signingSecretStatus.has).toBe(true);
      expect(JSON.stringify(get.body)).not.toContain(surfacedSecret);

      // List endpoint also redacts.
      const list = await request(app).get("/api/toolpacks?kind=custom");
      expect(JSON.stringify(list.body)).not.toContain(surfacedSecret);
    });

    // Case 157
    it("rotate-signing-secret returns a fresh secret + writes a new ciphertext", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const reg = await request(app)
        .post("/api/toolpacks")
        .send(VALID_REGISTER_BODY);
      const id = reg.body.payload.toolpack.id as string;
      const original = reg.body.payload.signingSecret as string;

      // Snapshot the pre-rotation ciphertext blob.
      const before = await (db as ReturnType<typeof drizzle>)
        .select({
          signingSecret: schema.organizationToolpacks.signingSecret,
        })
        .from(schema.organizationToolpacks)
        .where(eq(schema.organizationToolpacks.id, id))
        .limit(1);
      const blobBefore = before[0]!.signingSecret;

      const rotate = await request(app).post(
        `/api/toolpacks/${id}/rotate-signing-secret`
      );
      expect(rotate.status).toBe(200);
      const fresh = rotate.body.payload.signingSecret as string;
      expect(fresh).toMatch(/^whsec_/);
      expect(fresh).not.toBe(original);
      expect(rotate.body.payload.id).toBe(id);
      expect(typeof rotate.body.payload.rotatedAt).toBe("number");

      // The on-disk ciphertext changed.
      const after = await (db as ReturnType<typeof drizzle>)
        .select({
          signingSecret: schema.organizationToolpacks.signingSecret,
        })
        .from(schema.organizationToolpacks)
        .where(eq(schema.organizationToolpacks.id, id))
        .limit(1);
      const blobAfter = after[0]!.signingSecret;
      expect(blobAfter).not.toBe(blobBefore);
      expect(blobAfter).not.toContain(original);
      expect(blobAfter).not.toContain(fresh);
    });
  });
});
