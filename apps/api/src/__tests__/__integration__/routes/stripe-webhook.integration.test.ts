/**
 * Integration tests for `POST /api/webhooks/stripe` (#176 slice 3, cases
 * 19–25).
 *
 * Signature verification is REAL — payloads are signed with the `stripe`
 * library's test helper against a fixed test secret, and posted as raw
 * bytes through the real app mounting (the raw-body parser lives before
 * `express.json()`). Only the network converge read
 * (`StripeService.fetchSubscription`) is stubbed via `jest.spyOn`.
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
import Stripe from "stripe";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

// Keys must exist before `environment.ts` loads (transitively via app.js).
const WEBHOOK_SECRET = "whsec_integration_test_secret";
process.env.STRIPE_SECRET_KEY ??= "sk_test_integration_dummy";
process.env.STRIPE_WEBHOOK_SECRET ??= WEBHOOK_SECRET;

// Mock the auth middleware (app.js pulls in the protected router).
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: "auth0|stripe-webhook-test" } } as never;
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
const { environment } = await import("../../../environment.js");

// Signing helper — real Stripe HMAC over the exact payload string.
const stripeSigner = new Stripe("sk_test_signer_dummy");
function signed(payload: string): string {
  return stripeSigner.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
}

const ANCHOR_JUL_15 = Date.UTC(2026, 6, 15) / 1000;

function eventPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: `evt_${generateId()}`,
    object: "event",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_test_1", customer: "cus_test_1" } },
    ...overrides,
  };
}

function convergedSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_test_1",
    customer: "cus_test_1",
    status: "active",
    billing_cycle_anchor: ANCHOR_JUL_15,
    items: { data: [{ price: { id: "price_int_pro" } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("POST /api/webhooks/stripe", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;
  let userId: string;
  let fetchSpy: ReturnType<typeof jest.spyOn>;
  const PRO_SLUG = "test-pro-int";

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await db.delete(schema.stripeEvents);
    await teardownOrg(db);
    await db.delete(schema.tiers).where(eq(schema.tiers.slug, PRO_SLUG));

    // A purchasable paid tier mapped to the converged sub's price.
    await db.insert(schema.tiers).values({
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      slug: PRO_SLUG,
      displayName: "Pro (integration)",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: 10000,
      meteredRatePerMin: 50,
      expensiveUnitsPerPeriod: 1000,
      expensiveRatePerMin: 10,
      perToolCaps: null,
      stripePriceId: "price_int_pro",
      selectable: true,
    } as never);

    const user = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(user as never);
    userId = user.id;
    const org = createOrganization(userId, {
      stripeCustomerId: "cus_test_1",
    });
    await db.insert(schema.organizations).values(org as never);
    orgId = org.id;

    fetchSpy = jest
      .spyOn(StripeService, "fetchSubscription")
      .mockResolvedValue(convergedSub());
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await db.delete(schema.stripeEvents);
    await teardownOrg(db);
    await db.delete(schema.tiers).where(eq(schema.tiers.slug, PRO_SLUG));
    await connection.end();
  });

  async function orgRow() {
    const [row] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    return row;
  }

  async function eventRows(eventId: string) {
    return db
      .select()
      .from(schema.stripeEvents)
      .where(eq(schema.stripeEvents.eventId, eventId));
  }

  // ── case 19 ─────────────────────────────────────────────────────────

  it("valid signature + subscription.updated → 200, org tier/anchor written, applied row", async () => {
    const payload = JSON.stringify(eventPayload({ id: "evt_case19" }));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const org = await orgRow();
    expect(org.tier).toBe(PRO_SLUG);
    expect(org.stripeSubscriptionId).toBe("sub_test_1");
    expect(org.billingAnchorDay).toBe(15);
    expect(org.stripeCustomerId).toBe("cus_test_1");

    const rows = await eventRows("evt_case19");
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe("applied");
    expect(rows[0].organizationId).toBe(orgId);
    expect(rows[0].resultingTier).toBe(PRO_SLUG);
  });

  // ── case 20 ─────────────────────────────────────────────────────────

  it("redelivering the same event id → 200, a single row, org written once", async () => {
    const payload = JSON.stringify(eventPayload({ id: "evt_case20" }));

    const first = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);
    const second = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await eventRows("evt_case20");
    expect(rows.length).toBe(1);
    expect((await orgRow()).tier).toBe(PRO_SLUG);
  });

  // ── case 21 ─────────────────────────────────────────────────────────

  it("bad signature → 400, nothing written", async () => {
    const payload = JSON.stringify(eventPayload({ id: "evt_case21" }));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "t=1,v1=deadbeef")
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.WEBHOOK_INVALID_SIGNATURE);
    expect((await orgRow()).tier).toBe("standard");
    expect((await eventRows("evt_case21")).length).toBe(0);
  });

  it("missing signature → 400, nothing written", async () => {
    const payload = JSON.stringify(eventPayload({ id: "evt_case21b" }));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.WEBHOOK_MISSING_SIGNATURE);
    expect((await eventRows("evt_case21b")).length).toBe(0);
  });

  it("a tampered payload fails verification (signature is over the original bytes)", async () => {
    const original = JSON.stringify(eventPayload({ id: "evt_case21c" }));
    const tampered = original.replace("sub_test_1", "sub_evil_1");

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(original))
      .set("content-type", "application/json")
      .send(tampered);

    expect(res.status).toBe(400);
    expect((await eventRows("evt_case21c")).length).toBe(0);
  });

  // ── case 22 ─────────────────────────────────────────────────────────

  it("unknown customer → 200, unmatched row, org untouched", async () => {
    fetchSpy.mockResolvedValue(
      convergedSub({ customer: "cus_nobody" }) as never
    );
    const payload = JSON.stringify(eventPayload({ id: "evt_case22" }));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    const rows = await eventRows("evt_case22");
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe("unmatched");
    expect(rows[0].organizationId).toBeNull();
    expect((await orgRow()).tier).toBe("standard");
  });

  // ── case 23 ─────────────────────────────────────────────────────────

  it("unhandled event type → 200, ignored row, no converge fetch", async () => {
    const payload = JSON.stringify(
      eventPayload({ id: "evt_case23", type: "invoice.paid" })
    );

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    const rows = await eventRows("evt_case23");
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe("ignored");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await orgRow()).tier).toBe("standard");
  });

  // ── case 24 ─────────────────────────────────────────────────────────

  it("converge fetch failure → 500 (Stripe retries), no event row", async () => {
    fetchSpy.mockRejectedValue(new Error("stripe down") as never);
    const payload = JSON.stringify(eventPayload({ id: "evt_case24" }));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe(ApiCode.WEBHOOK_SYNC_FAILED);
    expect((await eventRows("evt_case24")).length).toBe(0);
    expect((await orgRow()).tier).toBe("standard");
  });

  it("mid-transaction failure rolls the dedup row back (retryable)", async () => {
    // A second org already owns the converged subscription id — the org
    // UPDATE violates the UNIQUE and fails after the event-row insert.
    const other = createOrganization(userId, {
      stripeCustomerId: "cus_other",
      stripeSubscriptionId: "sub_test_1",
    });
    await db.insert(schema.organizations).values(other as never);

    const payload = JSON.stringify(eventPayload({ id: "evt_case24b" }));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(500);
    // Rollback removed the dedup row — the Stripe retry will process cleanly.
    expect((await eventRows("evt_case24b")).length).toBe(0);
    expect((await orgRow()).tier).toBe("standard");
  });

  // ── case 25 ─────────────────────────────────────────────────────────

  it("raw-body exactness: non-canonical JSON (spacing) verifies and applies", async () => {
    // Whitespace makes the posted bytes differ from any re-serialization —
    // verification succeeds only if the route hands Stripe the raw buffer.
    const payload = `{\n  "id":   "evt_case25",\n  "object": "event",\n  "type": "customer.subscription.updated",\n  "data": { "object": { "id": "sub_test_1",   "customer": "cus_test_1" } }\n}`;
    expect(JSON.stringify(JSON.parse(payload))).not.toBe(payload);

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", signed(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    const rows = await eventRows("evt_case25");
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe("applied");
    expect((await orgRow()).tier).toBe(PRO_SLUG);
  });

  // ── unconfigured guard ──────────────────────────────────────────────

  it("503 WEBHOOK_MISSING_SECRET when Stripe env keys are absent", async () => {
    const saved = environment.STRIPE_WEBHOOK_SECRET;
    (environment as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET =
      undefined;
    try {
      const payload = JSON.stringify(eventPayload({ id: "evt_case503" }));
      const res = await request(app)
        .post("/api/webhooks/stripe")
        .set("stripe-signature", signed(payload))
        .set("content-type", "application/json")
        .send(payload);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe(ApiCode.WEBHOOK_MISSING_SECRET);
      expect((await eventRows("evt_case503")).length).toBe(0);
    } finally {
      (
        environment as { STRIPE_WEBHOOK_SECRET?: string }
      ).STRIPE_WEBHOOK_SECRET = saved;
    }
  });
});
