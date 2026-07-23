/**
 * Integration tests for the billing router: the enriched, org-scoped plan
 * list (#241, cases 14–15) through the real app mounting — full policy per
 * tier, `cta`, blurb, multi-tenant isolation (another org's private custom
 * tier is excluded) — plus the member/owner authz split. Stripe price reads
 * are stubbed via `jest.spyOn` (no network).
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
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
} from "../utils/application.util.js";

// Stripe env keys must exist before environment.ts loads (isConfigured guard).
process.env.STRIPE_SECRET_KEY ??= "sk_test_integration_dummy";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_integration_test_secret";

// Switchable auth: `currentAuth0Id = null` simulates an anonymous caller.
let currentAuth0Id: string | null = null;
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuth0Id) return res.status(401).end();
    req.auth = { payload: { sub: currentAuth0Id } } as never;
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
const { StripeService } = await import("../../../services/stripe.service.js");

const OWNER_AUTH0 = `auth0|billing-owner-${generateId().slice(0, 8)}`;
const MEMBER_AUTH0 = `auth0|billing-member-${generateId().slice(0, 8)}`;
const PRO_SLUG = "test-billing-pro";
const CUSTOM_SLUG = "test-billing-custom";
// #241: a custom tier scoped to the caller's org (appears) and one scoped to
// a different org (must NOT appear — multi-tenant isolation).
const SCOPED_SLUG = "test-billing-scoped-mine";
const OTHER_SCOPED_SLUG = "test-billing-scoped-other";
const ALL_TEST_SLUGS = [PRO_SLUG, CUSTOM_SLUG, SCOPED_SLUG, OTHER_SCOPED_SLUG];

function testTier(slug: string, overrides: Record<string, unknown> = {}) {
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
    meteredUnitsPerPeriod: 5000,
    meteredRatePerMin: 30,
    expensiveUnitsPerPeriod: 500,
    expensiveRatePerMin: 8,
    perToolCaps: null,
    stripePriceId: null,
    selectable: false,
    ...overrides,
  };
}

describe("Billing router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let priceSpy!: ReturnType<typeof jest.spyOn>;
  let orgId!: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    // Tiers first (their FK → organizations blocks the org teardown otherwise).
    for (const slug of ALL_TEST_SLUGS) {
      await db.delete(schema.tiers).where(eq(schema.tiers.slug, slug));
    }
    await teardownOrg(db);

    const owner = createUser(OWNER_AUTH0);
    const member = createUser(MEMBER_AUTH0);
    await db.insert(schema.users).values(owner as never);
    await db.insert(schema.users).values(member as never);
    const org = createOrganization(owner.id);
    orgId = org.id;
    const otherOrg = createOrganization(owner.id);
    await db.insert(schema.organizations).values([org, otherOrg] as never);
    await db
      .insert(schema.organizationUsers)
      .values(createOrganizationUser(org.id, owner.id) as never);
    await db
      .insert(schema.organizationUsers)
      .values(createOrganizationUser(org.id, member.id) as never);

    // Plan-list fixtures: a public priced `subscribe` tier, an unlisted custom
    // one, a custom tier scoped to the caller's org, and one scoped to another.
    await db.insert(schema.tiers).values([
      testTier(PRO_SLUG, {
        selectable: true,
        stripePriceId: "price_billing_pro",
        cta: "subscribe",
        description: "Everything in Standard, plus more.",
      }),
      testTier(CUSTOM_SLUG),
      testTier(SCOPED_SLUG, {
        selectable: true,
        cta: "contact",
        description: "Tailored to your org.",
        visibleToOrganizationId: org.id,
      }),
      testTier(OTHER_SCOPED_SLUG, {
        selectable: true,
        cta: "contact",
        visibleToOrganizationId: otherOrg.id,
      }),
    ] as never);

    currentAuth0Id = OWNER_AUTH0;
    priceSpy = jest.spyOn(StripeService, "getPrice").mockResolvedValue({
      unitAmount: 4900,
      currency: "usd",
      interval: "month",
    } as never);
  });

  afterEach(async () => {
    priceSpy.mockRestore();
    // Tiers before orgs — the visible_to_organization_id FK blocks otherwise.
    for (const slug of ALL_TEST_SLUGS) {
      await db.delete(schema.tiers).where(eq(schema.tiers.slug, slug));
    }
    await teardownOrg(db);
    await connection.end();
  });

  // ── case 26 ─────────────────────────────────────────────────────────

  describe("GET /api/billing/tiers", () => {
    type WireTier = {
      slug: string;
      cta: string;
      description: string | null;
      price: unknown;
      policy: { allocations: Record<string, unknown> };
    };

    // ── case 14: enriched, org-scoped payload ─────────────────────────
    it("returns the enriched policy per tier, scoped to the caller's org", async () => {
      const res = await request(app).get("/api/billing/tiers");

      expect(res.status).toBe(200);
      const tiers = res.body.payload.tiers as WireTier[];
      const slugs = tiers.map((t) => t.slug);

      // Public + the caller's own custom tier are listed; the unlisted custom
      // tier and ANOTHER org's private tier are not (multi-tenant isolation).
      expect(slugs).toContain("standard");
      expect(slugs).toContain(PRO_SLUG);
      expect(slugs).toContain(SCOPED_SLUG);
      expect(slugs).not.toContain(CUSTOM_SLUG);
      expect(slugs).not.toContain(OTHER_SCOPED_SLUG);

      const standard = tiers.find((t) => t.slug === "standard")!;
      expect(standard.cta).toBe("none");
      expect(standard.price).toBeNull();

      const pro = tiers.find((t) => t.slug === PRO_SLUG)!;
      expect(pro.cta).toBe("subscribe");
      expect(pro.description).toBe("Everything in Standard, plus more.");
      expect(pro.price).toEqual({
        unitAmount: 4900,
        currency: "usd",
        interval: "month",
      });
      expect(pro.policy.allocations).toHaveProperty("metered");

      const scoped = tiers.find((t) => t.slug === SCOPED_SLUG)!;
      expect(scoped.cta).toBe("contact");
      expect(scoped.price).toBeNull();
    });

    it("null-degrades the price (cta stays subscribe) when the Stripe read fails", async () => {
      priceSpy.mockResolvedValue(null as never);

      const res = await request(app).get("/api/billing/tiers");

      expect(res.status).toBe(200);
      const pro = (res.body.payload.tiers as WireTier[]).find(
        (t) => t.slug === PRO_SLUG
      )!;
      expect(pro.cta).toBe("subscribe");
      expect(pro.price).toBeNull();
    });
  });

  // ── case 27 ─────────────────────────────────────────────────────────

  describe("endpoint auth", () => {
    it("401s every billing route for an anonymous caller", async () => {
      currentAuth0Id = null;

      expect((await request(app).get("/api/billing/tiers")).status).toBe(401);
      expect(
        (
          await request(app)
            .post("/api/billing/checkout")
            .send({ tier: PRO_SLUG })
        ).status
      ).toBe(401);
      expect((await request(app).post("/api/billing/portal")).status).toBe(401);
    });

    it("lets a non-owner member read the plan list", async () => {
      currentAuth0Id = MEMBER_AUTH0;

      const res = await request(app).get("/api/billing/tiers");
      expect(res.status).toBe(200);
      expect(res.body.payload.tiers.length).toBeGreaterThan(0);
    });

    it("403s the same member on checkout and portal", async () => {
      currentAuth0Id = MEMBER_AUTH0;

      const checkout = await request(app)
        .post("/api/billing/checkout")
        .send({ tier: PRO_SLUG });
      expect(checkout.status).toBe(403);
      expect(checkout.body.code).toBe(ApiCode.BILLING_NOT_OWNER);

      const portal = await request(app).post("/api/billing/portal");
      expect(portal.status).toBe(403);
      expect(portal.body.code).toBe(ApiCode.BILLING_NOT_OWNER);
    });

    it("400s a malformed checkout body before resolving anything", async () => {
      const res = await request(app).post("/api/billing/checkout").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.BILLING_INVALID_PAYLOAD);
    });
  });

  // ── #260: in-app plan switch via the portal ─────────────────────────
  describe("POST /api/billing/portal — switch flow", () => {
    let portalSpy!: ReturnType<typeof jest.spyOn>;
    let subSpy!: ReturnType<typeof jest.spyOn>;

    beforeEach(async () => {
      // Give the caller's org a live customer + subscription so a switch is valid.
      await db
        .update(schema.organizations)
        .set({
          stripeCustomerId: "cus_switch",
          stripeSubscriptionId: "sub_switch",
        })
        .where(eq(schema.organizations.id, orgId));
      portalSpy = jest
        .spyOn(StripeService, "createPortalSession")
        .mockResolvedValue({
          url: "https://billing.stripe.com/p/switch",
        } as never);
      subSpy = jest
        .spyOn(StripeService, "fetchSubscription")
        .mockResolvedValue({ items: { data: [{ id: "si_switch" }] } } as never);
    });

    afterEach(() => {
      portalSpy.mockRestore();
      subSpy.mockRestore();
    });

    // ── case 7 ────────────────────────────────────────────────────────
    it("opens the subscription-update flow for a target tier; bodyless = Manage", async () => {
      const res = await request(app)
        .post("/api/billing/portal")
        .send({ tier: PRO_SLUG });
      expect(res.status).toBe(200);
      expect(res.body.payload.url).toBe("https://billing.stripe.com/p/switch");
      expect(portalSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionUpdate: expect.objectContaining({
            subscriptionId: "sub_switch",
            itemId: "si_switch",
            priceId: "price_billing_pro",
          }),
        })
      );

      const manage = await request(app).post("/api/billing/portal");
      expect(manage.status).toBe(200);
    });

    // ── case 8 ────────────────────────────────────────────────────────
    it("400s a malformed body (non-string tier)", async () => {
      const res = await request(app)
        .post("/api/billing/portal")
        .send({ tier: 5 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.BILLING_INVALID_PAYLOAD);
    });
  });
});
