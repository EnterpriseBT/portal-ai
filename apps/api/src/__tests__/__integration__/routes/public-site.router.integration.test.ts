/**
 * Integration tests for `GET /api/public/site-config` (#311 slice 3) —
 * the first deliberately-anonymous data endpoint. jwtCheck is mocked to
 * REJECT everything, so a 200 here proves the public router escapes auth
 * by mount position, not by a permissive token check. Multi-tenancy proof:
 * a seeded org-private tier row must be absent from the snapshot.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Response } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

// A small deterministic rate limit for the flood test (read before
// environment.ts loads). 65 attempts against a 30/min window guarantee at
// least one 429 even if a wall-clock minute boundary splits the flood.
process.env.PUBLIC_SITE_RATE_LIMIT_PER_MIN = "30";

// The public route must never pass through jwtCheck — mock it to reject
// EVERYTHING so any accidental routing through the protected router fails.
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: unknown, res: Response) => res.status(401).end(),
}));
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");
const { StripeService } = await import("../../../services/stripe.service.js");
const { SiteConfigService } =
  await import("../../../services/site-config.service.js");

const PRICE = { unitAmount: 2900, currency: "usd", interval: "month" as const };

describe("GET /api/public/site-config (#311)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  const createdSlugs: string[] = [];
  let orgA: string;
  let publicSlug: string;
  let pricedSlug: string;
  let privateSlug: string;
  let hiddenSlug: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db);
    const user = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(user as never);
    const a = createOrganization(user.id);
    await db.insert(schema.organizations).values([a] as never);
    orgA = a.id;

    publicSlug = `pub-${generateId()}`;
    pricedSlug = `priced-${generateId()}`;
    privateSlug = `acme-${generateId()}`;
    hiddenSlug = `hidden-${generateId()}`;
    await db.insert(schema.tiers).values([
      tierRow(publicSlug, {
        public: true,
        displayOrder: 1,
        cta: "contact",
        description: "Talk to us.",
      }),
      tierRow(pricedSlug, {
        public: true,
        displayOrder: 2,
        cta: "subscribe",
        stripePriceId: `price_${generateId()}`,
      }),
      // Org-private (non-public — the CHECK forbids the combination).
      tierRow(privateSlug, {
        public: false,
        visibleToOrganizationId: orgA,
        description: "Private deal.",
      }),
      tierRow(hiddenSlug, { public: false }),
    ] as never);

    jest.spyOn(StripeService, "getPrice").mockResolvedValue(PRICE);
    SiteConfigService.clearCache();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (createdSlugs.length > 0) {
      await db
        .delete(schema.tiers)
        .where(inArray(schema.tiers.slug, createdSlugs));
      createdSlugs.length = 0;
    }
    await teardownOrg(db);
    await connection.end();
  });

  function tierRow(slug: string, overrides: Record<string, unknown> = {}) {
    if (!createdSlugs.includes(slug)) createdSlugs.push(slug);
    return {
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      slug,
      displayName: slug,
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: 500,
      meteredRatePerMin: 10,
      expensiveUnitsPerPeriod: 20,
      expensiveRatePerMin: 2,
      perToolCaps: null,
      stripePriceId: null,
      selectable: true,
      builtinToolpacks: ["data_query"],
      customToolpacks: false,
      cta: "none",
      public: false,
      displayOrder: 0,
      description: null,
      visibleToOrganizationId: null,
      ...overrides,
    };
  }

  // ── case 1 — 200 with NO Authorization header ─────────────────────
  it("returns 200 with no Authorization header (escapes jwtCheck by mount)", async () => {
    const res = await request(app).get("/api/public/site-config");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.tiers.length).toBeGreaterThanOrEqual(2);
  });

  // ── case 2 — contract-shaped, no tenant/user/usage data ───────────
  it("serves the pinned presentation shape and nothing else", async () => {
    const res = await request(app).get("/api/public/site-config");
    const payload = res.body.payload;

    expect(Object.keys(payload).sort()).toEqual([
      "contact",
      "generatedAt",
      "tiers",
    ]);
    const priced = payload.tiers.find(
      (t: { slug: string }) => t.slug === pricedSlug
    );
    expect(Object.keys(priced).sort()).toEqual([
      "builtinToolpacks",
      "credits",
      "cta",
      "customToolpacks",
      "description",
      "displayName",
      "displayOrder",
      "price",
      "slug",
    ]);
    expect(priced.price).toEqual(PRICE);
    expect(priced.credits).toEqual({ metered: 500, expensive: 20 });
    // The org id must appear nowhere in the serialized response.
    expect(JSON.stringify(res.body)).not.toContain(orgA);
  });

  // ── case 3 — an org-private tier is provably absent ───────────────
  it("excludes org-private and non-public tiers from the snapshot", async () => {
    const res = await request(app).get("/api/public/site-config");
    const slugs = res.body.payload.tiers.map((t: { slug: string }) => t.slug);
    expect(slugs).toContain(publicSlug);
    expect(slugs).toContain(pricedSlug);
    expect(slugs).not.toContain(privateSlug);
    expect(slugs).not.toContain(hiddenSlug);
  });

  // ── case 4 — cacheable response headers ───────────────────────────
  it("sets a positive Cache-Control header", async () => {
    const res = await request(app).get("/api/public/site-config");
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=60, s-maxage=300"
    );
  });

  // ── case 5 — the per-IP rate limit denies 429 (LAST: floods) ──────
  it("denies 429 SITE_CONFIG_RATE_LIMITED once the window is exhausted", async () => {
    let saw429 = false;
    for (let i = 0; i < 65 && !saw429; i++) {
      const res = await request(app).get("/api/public/site-config");
      if (res.status === 429) {
        expect(res.body.code).toBe(ApiCode.SITE_CONFIG_RATE_LIMITED);
        saw429 = true;
      }
    }
    expect(saw429).toBe(true);
  });
});
