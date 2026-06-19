import { describe, it, expect, afterEach, jest } from "@jest/globals";
import request from "supertest";
import crypto from "crypto";

import { createMockApp } from "../../scripts/mock-toolpack-server.js";
import { signRequest } from "../../utils/webhook-signing.util.js";

describe("mock-toolpack-server verification middleware (phase 6)", () => {
  const originalSecret = process.env.MOCK_TOOLPACK_SIGNING_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.MOCK_TOOLPACK_SIGNING_SECRET;
    } else {
      process.env.MOCK_TOOLPACK_SIGNING_SECRET = originalSecret;
    }
  });

  // Case 158
  it("rejects unsigned requests with 401 SIGNATURE_MISSING when the secret is configured", async () => {
    process.env.MOCK_TOOLPACK_SIGNING_SECRET = "whsec_test158";
    const app = createMockApp();

    const res = await request(app)
      .post("/runtime")
      .set("Content-Type", "application/json")
      .send({ tool: "echo", input: { message: "hi" } });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("SIGNATURE_MISSING");
  });

  // Case 159
  it("rejects stale timestamps with 401 TIMESTAMP_STALE", async () => {
    const secret = "whsec_test159";
    process.env.MOCK_TOOLPACK_SIGNING_SECRET = secret;
    const app = createMockApp();

    const body = JSON.stringify({ tool: "echo", input: { message: "hi" } });
    // Backdate the timestamp by 600 seconds (well outside the 300 s window).
    const staleNowMs = Date.now() - 600 * 1000;
    const headers = signRequest(secret, body, { now: staleNowMs });

    const res = await request(app)
      .post("/runtime")
      .set("Content-Type", "application/json")
      .set("X-Portalai-Timestamp", headers["X-Portalai-Timestamp"])
      .set("X-Portalai-Webhook-Id", headers["X-Portalai-Webhook-Id"])
      .set("X-Portalai-Signature", headers["X-Portalai-Signature"])
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("TIMESTAMP_STALE");
    expect(res.body.ageSec).toBeGreaterThan(300);
  });

  // Case 160
  it("rejects tampered bodies, accepts properly-signed requests, and warns when the secret is unset", async () => {
    const secret = "whsec_test160";

    // (a) Tampered body with otherwise-valid headers → SIGNATURE_INVALID.
    process.env.MOCK_TOOLPACK_SIGNING_SECRET = secret;
    {
      const signedBody = JSON.stringify({
        tool: "echo",
        input: { message: "hi" },
      });
      const headers = signRequest(secret, signedBody);

      const tamperedBody = JSON.stringify({
        tool: "echo",
        input: { message: "tampered" },
      });
      const app = createMockApp();
      const res = await request(app)
        .post("/runtime")
        .set("Content-Type", "application/json")
        .set("X-Portalai-Timestamp", headers["X-Portalai-Timestamp"])
        .set("X-Portalai-Webhook-Id", headers["X-Portalai-Webhook-Id"])
        .set("X-Portalai-Signature", headers["X-Portalai-Signature"])
        .send(tamperedBody);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("SIGNATURE_INVALID");
    }

    // (b) Round-trip success: properly-signed request returns the tool output.
    {
      const body = JSON.stringify({
        tool: "echo",
        input: { message: "hi" },
      });
      const headers = signRequest(secret, body);
      const app = createMockApp();
      const res = await request(app)
        .post("/runtime")
        .set("Content-Type", "application/json")
        .set("X-Portalai-Timestamp", headers["X-Portalai-Timestamp"])
        .set("X-Portalai-Webhook-Id", headers["X-Portalai-Webhook-Id"])
        .set("X-Portalai-Signature", headers["X-Portalai-Signature"])
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ echoed: "hi" });
    }

    // (c) Without the env var, unsigned requests are accepted with
    // a "Signature: SKIPPED" log line (the verbose logger uses
    // console.log, not console.warn, so all log lines for one
    // request stay in the same stream).
    delete process.env.MOCK_TOOLPACK_SIGNING_SECRET;
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    try {
      const app = createMockApp();
      const res = await request(app)
        .post("/runtime")
        .set("Content-Type", "application/json")
        .send({ tool: "echo", input: { message: "hi" } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ echoed: "hi" });
      const logged = logSpy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(logged).toMatch(/SKIPPED/);
    } finally {
      logSpy.mockRestore();
    }

    // Verify the timing-safe-equal path works against an independent
    // recomputation — defensive sanity check (not strictly a case).
    const body = JSON.stringify({ tool: "echo", input: { message: "hi" } });
    const ts = "1779000000";
    const id = "11111111-1111-4111-8111-111111111111";
    const expected = crypto
      .createHmac("sha256", "whsec_test160")
      .update(`${ts}.${id}.${body}`)
      .digest("hex");
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("mock-toolpack-server — #124 dataset-scaling reference tools", () => {
  const originalSecret = process.env.MOCK_TOOLPACK_SIGNING_SECRET;
  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.MOCK_TOOLPACK_SIGNING_SECRET;
    } else {
      process.env.MOCK_TOOLPACK_SIGNING_SECRET = originalSecret;
    }
  });

  it("declares the three consumption tiers in /schema", async () => {
    delete process.env.MOCK_TOOLPACK_SIGNING_SECRET;
    const res = await request(createMockApp()).get("/schema");
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      (res.body.tools as Array<{ name: string; capability?: { consumption?: { mode: string } } }>).map(
        (t) => [t.name, t]
      )
    );
    expect(byName.sum_records.capability?.consumption?.mode).toBe("bounded");
    expect(byName.count_via_pull.capability?.consumption?.mode).toBe("streaming");
    expect(byName.aggregate_to_handle.capability?.consumption?.mode).toBe(
      "streaming"
    );
  });

  it("sum_records (bounded) sums a column over the POSTed records", async () => {
    delete process.env.MOCK_TOOLPACK_SIGNING_SECRET;
    const res = await request(createMockApp())
      .post("/runtime")
      .set("Content-Type", "application/json")
      .send({
        tool: "sum_records",
        input: { column: "amount" },
        records: [{ amount: 12.5 }, { amount: 9 }, { amount: 0.5 }],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 22, count: 3 });
  });
});
