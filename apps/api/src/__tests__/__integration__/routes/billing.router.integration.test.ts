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
  seedRbacForOrg,
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
    // #881: GET /tiers self-provisions an unknown subject, which reads the
    // profile. Defined in the factory (see organization.router's test).
    getAuth0UserProfile: jest.fn(async () => ({
      email: "billing-first-login@example.com",
      name: "Billing First Login",
      picture: null,
      email_verified: true,
    })),
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
    await seedRbacForOrg(db, org.id);
    await seedRbacForOrg(db, otherOrg.id);
    await db
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(org.id, owner.id, { role: "owner" }) as never
      );
    await db
      .insert(schema.organizationUsers)
      .values(createOrganizationUser(org.id, member.id) as never);

    // Plan-list fixtures: a public priced `subscribe` tier, an unlisted custom
    // one, a custom tier scoped to the caller's org, and one scoped to another.
    await db.insert(schema.tiers).values([
      testTier(PRO_SLUG, {
        selectable: true,
        public: true, // #536: a global tier must be public to be a billing card
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

    // #881: the Billing tab can be a new user's first page.
    it("self-provisions an unknown subject on the plan list", async () => {
      currentAuth0Id = `auth0|billing-new-${generateId().slice(0, 8)}`;
      const res = await request(app).get("/api/billing/tiers");
      expect(res.status).toBe(200);
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
      expect(checkout.body.code).toBe(ApiCode.PERMISSION_DENIED);
      // #711: names the permission, not a role.
      expect(checkout.body.message).toBe(
        "You don't have permission to manage billing."
      );

      const portal = await request(app).post("/api/billing/portal");
      expect(portal.status).toBe(403);
      expect(portal.body.code).toBe(ApiCode.PERMISSION_DENIED);
    });

    it("400s a malformed checkout body before resolving anything", async () => {
      const res = await request(app).post("/api/billing/checkout").send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.BILLING_INVALID_PAYLOAD);
      // #745: names the field; every issue is in details.
      expect(res.body.message).toMatch(/^Invalid checkout payload: tier: /);
      expect(res.body.details.issues[0].path).toEqual(["tier"]);
    });
  });

  // ── #938: a rename racing the first checkout ────────────────────────

  describe("POST /api/billing/checkout — rename during customer creation", () => {
    it("waits for a rename holding the org row, then syncs the Stripe name", async () => {
      const [before] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
      const customerSpy = jest
        .spyOn(StripeService, "createCustomer")
        .mockResolvedValue({ id: "cus_race_938" });
      const sessionSpy = jest
        .spyOn(StripeService, "createCheckoutSession")
        .mockResolvedValue({ url: "https://checkout.stripe.com/c/race" });
      const nameSpy = jest
        .spyOn(StripeService, "updateCustomerName")
        .mockResolvedValue(undefined);

      const renamer = postgres(process.env.DATABASE_URL!, { max: 1 });
      let settled = false;
      let checkout: Promise<request.Response> | undefined;
      try {
        await renamer.begin(async (tx) => {
          // What a rename does under OrganizationUpdateService.apply.
          await tx`select id from organizations where id = ${orgId} for update`;
          await tx`update organizations set name = 'Renamed Mid Checkout' where id = ${orgId}`;

          checkout = request(app)
            .post("/api/billing/checkout")
            .send({ tier: PRO_SLUG })
            .then((res) => {
              settled = true;
              return res;
            });
          // Commit only once the checkout has read the org and sent its name
          // to Stripe, so the rename lands between that read and the id write.
          const deadline = Date.now() + 10_000;
          while (customerSpy.mock.calls.length === 0) {
            if (settled || Date.now() > deadline) {
              throw new Error("checkout never reached customer creation");
            }
            await new Promise((r) => setTimeout(r, 20));
          }
          await new Promise((r) => setTimeout(r, 100));
          // The customer id write is blocked behind the uncommitted rename.
          expect(settled).toBe(false);
        });

        const res = await checkout!;
        expect(res.status).toBe(200);
        expect(customerSpy).toHaveBeenCalledWith(
          expect.objectContaining({ name: before.name })
        );
        expect(nameSpy).toHaveBeenCalledWith(
          "cus_race_938",
          "Renamed Mid Checkout"
        );
        const [after] = await db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.id, orgId));
        expect(after.stripeCustomerId).toBe("cus_race_938");
      } finally {
        await renamer.end();
        // Let a request left running by a failed assertion finish against the
        // spies before restoring them, so it can't reach the real Stripe client.
        await checkout?.catch(() => undefined);
        customerSpy.mockRestore();
        sessionSpy.mockRestore();
        nameSpy.mockRestore();
      }
    });
  });

  // ── #939: Stripe's state and one checkout at a time ─────────────────
  describe("POST /api/billing/checkout — duplicate subscriptions", () => {
    let spies: ReturnType<typeof jest.spyOn>[] = [];

    afterEach(() => {
      for (const spy of spies) spy.mockRestore();
      spies = [];
    });

    it("serialises two first checkouts: one customer, and the second expires the first's session", async () => {
      // Slow customer creation keeps the first checkout holding the lock
      // while the second arrives.
      const customerSpy = jest
        .spyOn(StripeService, "createCustomer")
        .mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 300));
          return { id: "cus_939" };
        });
      const sessionSpy = jest
        .spyOn(StripeService, "createCheckoutSession")
        .mockResolvedValue({ url: "https://checkout.stripe.com/c/939" });
      const listSubsSpy = jest
        .spyOn(StripeService, "listSubscriptions")
        .mockResolvedValue([]);
      const listOpenSpy = jest
        .spyOn(StripeService, "listOpenCheckoutSessions")
        .mockResolvedValue(["cs_first_tab"]);
      const expireSpy = jest
        .spyOn(StripeService, "expireCheckoutSession")
        .mockResolvedValue(true);
      spies = [customerSpy, sessionSpy, listSubsSpy, listOpenSpy, expireSpy];

      const [first, second] = await Promise.all([
        request(app).post("/api/billing/checkout").send({ tier: PRO_SLUG }),
        request(app).post("/api/billing/checkout").send({ tier: PRO_SLUG }),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(customerSpy).toHaveBeenCalledTimes(1);
      expect(listSubsSpy).toHaveBeenCalledWith("cus_939");
      expect(expireSpy).toHaveBeenCalledWith("cs_first_tab");
      expect(sessionSpy).toHaveBeenCalledTimes(2);
      const [after] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
      expect(after.stripeCustomerId).toBe("cus_939");
    });

    it("409s when Stripe lists a live subscription the webhook never recorded", async () => {
      await db
        .update(schema.organizations)
        .set({ stripeCustomerId: "cus_paid_939" })
        .where(eq(schema.organizations.id, orgId));
      const listSubsSpy = jest
        .spyOn(StripeService, "listSubscriptions")
        .mockResolvedValue([{ id: "sub_paid", status: "active" } as never]);
      const sessionSpy = jest.spyOn(StripeService, "createCheckoutSession");
      spies = [listSubsSpy, sessionSpy];

      const res = await request(app)
        .post("/api/billing/checkout")
        .send({ tier: PRO_SLUG });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiCode.BILLING_ALREADY_SUBSCRIBED);
      expect(sessionSpy).not.toHaveBeenCalled();
    });
  });

  // ── #939: POST /api/billing/sync ────────────────────────────────────
  describe("POST /api/billing/sync", () => {
    let listSpy!: ReturnType<typeof jest.spyOn>;

    beforeEach(async () => {
      await db
        .update(schema.organizations)
        .set({ stripeCustomerId: "cus_sync_939" })
        .where(eq(schema.organizations.id, orgId));
      listSpy = jest
        .spyOn(StripeService, "listSubscriptions")
        .mockResolvedValue([
          {
            id: "sub_sync_939",
            status: "active",
            created: 100,
            billing_cycle_anchor: Date.UTC(2026, 6, 15) / 1000,
            items: { data: [{ price: { id: "price_billing_pro" } }] },
          } as never,
        ]);
    });

    afterEach(async () => {
      listSpy.mockRestore();
      // The sync moved the org onto the test tier, which the outer teardown
      // deletes; put it back and drop the ledger rows that name the org.
      await db
        .delete(schema.commercialEvents)
        .where(eq(schema.commercialEvents.organizationId, orgId));
      await db
        .update(schema.organizations)
        .set({ tier: "standard", stripeSubscriptionId: null })
        .where(eq(schema.organizations.id, orgId));
    });

    async function syncRows() {
      return db
        .select()
        .from(schema.commercialEvents)
        .where(eq(schema.commercialEvents.organizationId, orgId));
    }

    it("converges a paid plan the webhook never delivered, and records it once", async () => {
      const res = await request(app).post("/api/billing/sync");

      expect(res.status).toBe(200);
      expect(res.body.payload).toEqual({
        tier: PRO_SLUG,
        subscription: "live",
      });
      const [org] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
      expect(org.tier).toBe(PRO_SLUG);
      expect(org.stripeSubscriptionId).toBe("sub_sync_939");
      expect(org.billingAnchorDay).toBe(15);
      let rows = await syncRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("billing.sync");
      expect(rows[0].outcome).toBe("applied");

      // Nothing changed since, so a repeat records nothing.
      const again = await request(app).post("/api/billing/sync").send({});
      expect(again.status).toBe(200);
      rows = await syncRows();
      expect(rows).toHaveLength(1);
    });

    it("400s a body with a key", async () => {
      const res = await request(app)
        .post("/api/billing/sync")
        .send({ tier: PRO_SLUG });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.BILLING_INVALID_PAYLOAD);
    });

    it("403s a member without billing.manage, and changes nothing", async () => {
      currentAuth0Id = MEMBER_AUTH0;

      const res = await request(app).post("/api/billing/sync");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ApiCode.PERMISSION_DENIED);
      expect(listSpy).not.toHaveBeenCalled();
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
      expect(res.body.message).toMatch(
        /^Invalid billing portal payload: tier: /
      );
    });
  });
});
