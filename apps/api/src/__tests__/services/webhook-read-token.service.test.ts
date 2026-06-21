import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";

// In-memory Redis fake — the token service only uses set/get/del. PX expiry is
// ignored here; logical expiry is exercised through the `now` seam instead.
const store = new Map<string, string>();
const fakeRedis = {
  set: async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  },
  get: async (k: string) => store.get(k) ?? null,
  del: async (k: string) => (store.delete(k) ? 1 : 0),
};
jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => fakeRedis,
}));

const { WebhookReadTokenService } = await import(
  "../../services/webhook-read-token.service.js"
);

const SCOPE = { organizationId: "org-1", handleId: "qh-abc", mode: "read" as const };

describe("WebhookReadTokenService", () => {
  beforeEach(() => store.clear());

  it("mints a token that validates against its exact scope, returning the record", async () => {
    const token = await WebhookReadTokenService.mint(SCOPE);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, opaque
    const rec = await WebhookReadTokenService.validate(token, {
      handleId: "qh-abc",
      mode: "read",
    });
    expect(rec.organizationId).toBe("org-1");
    expect(rec.handleId).toBe("qh-abc");
    expect(rec.mode).toBe("read");
  });

  it("rejects an unknown/malformed token as INVALID (401)", async () => {
    await expect(
      WebhookReadTokenService.validate("not-a-real-token", {
        handleId: "qh-abc",
        mode: "read",
      })
    ).rejects.toMatchObject({
      code: ApiCode.WEBHOOK_READ_TOKEN_INVALID,
      status: 401,
    });
  });

  it("rejects an undefined token (no Authorization) as INVALID", async () => {
    await expect(
      WebhookReadTokenService.validate(undefined, {
        handleId: "qh-abc",
        mode: "read",
      })
    ).rejects.toMatchObject({ code: ApiCode.WEBHOOK_READ_TOKEN_INVALID });
  });

  it("rejects a token past its expiry as EXPIRED (401)", async () => {
    const token = await WebhookReadTokenService.mint({ ...SCOPE, now: 1_000, ttlMs: 5_000 });
    // now (10_000) > exp (6_000)
    await expect(
      WebhookReadTokenService.validate(
        token,
        { handleId: "qh-abc", mode: "read" },
        { now: 10_000 }
      )
    ).rejects.toMatchObject({
      code: ApiCode.WEBHOOK_READ_TOKEN_EXPIRED,
      status: 401,
    });
  });

  it("rejects a wrong-handle token as SCOPE_MISMATCH (403)", async () => {
    const token = await WebhookReadTokenService.mint(SCOPE);
    await expect(
      WebhookReadTokenService.validate(token, {
        handleId: "qh-OTHER",
        mode: "read",
      })
    ).rejects.toMatchObject({
      code: ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH,
      status: 403,
    });
  });

  it("does not let a read token satisfy a write request (mode is scoped)", async () => {
    const token = await WebhookReadTokenService.mint(SCOPE); // read
    await expect(
      WebhookReadTokenService.validate(token, {
        handleId: "qh-abc",
        mode: "write",
      })
    ).rejects.toMatchObject({ code: ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH });
  });

  it("revokes a token — subsequent validation fails closed (INVALID)", async () => {
    const token = await WebhookReadTokenService.mint(SCOPE);
    await WebhookReadTokenService.revoke(token);
    await expect(
      WebhookReadTokenService.validate(token, {
        handleId: "qh-abc",
        mode: "read",
      })
    ).rejects.toMatchObject({ code: ApiCode.WEBHOOK_READ_TOKEN_INVALID });
  });

  it("clamps a caller TTL above the ceiling down to the default", async () => {
    // mint with an absurd ttl; exp must be ≤ now + WEBHOOK_READ_TOKEN_TTL_MS.
    const token = await WebhookReadTokenService.mint({
      ...SCOPE,
      now: 0,
      ttlMs: 9_999_999_999,
    });
    // 11 min > the 10-min ceiling → would be expired if clamped, valid if not.
    await expect(
      WebhookReadTokenService.validate(
        token,
        { handleId: "qh-abc", mode: "read" },
        { now: 11 * 60 * 1000 }
      )
    ).rejects.toMatchObject({ code: ApiCode.WEBHOOK_READ_TOKEN_EXPIRED });
  });
});
