import { describe, it, expect } from "@jest/globals";
import crypto from "crypto";

import {
  signRequest,
  generateSigningSecret,
} from "../../utils/webhook-signing.util.js";

describe("webhook-signing.util", () => {
  // Case 140
  it("signRequest produces a deterministic HMAC-SHA256 over <ts>.<id>.<body>", () => {
    const secret = "test-secret-140";
    const body = "hello";
    const now = 1779000000000; // ms
    const webhookId = "11111111-1111-4111-8111-111111111111";

    const headers = signRequest(secret, body, { now, webhookId });

    expect(headers["X-Portalai-Timestamp"]).toBe(String(Math.floor(now / 1000)));
    expect(headers["X-Portalai-Webhook-Id"]).toBe(webhookId);

    // Recompute the signature independently and assert byte-for-byte match.
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${Math.floor(now / 1000)}.${webhookId}.${body}`)
      .digest("hex");
    expect(headers["X-Portalai-Signature"]).toBe(`v1=${expected}`);
  });

  // Case 141
  it("signRequest binds timestamp + webhookId + body into the digest", () => {
    const secret = "test-secret-141";
    const baseline = signRequest(secret, "hello", {
      now: 1779000000000,
      webhookId: "id-A",
    });

    // Different webhookId → different signature.
    const diffId = signRequest(secret, "hello", {
      now: 1779000000000,
      webhookId: "id-B",
    });
    expect(diffId["X-Portalai-Signature"]).not.toBe(
      baseline["X-Portalai-Signature"]
    );

    // Different now → different signature.
    const diffNow = signRequest(secret, "hello", {
      now: 1779000001000,
      webhookId: "id-A",
    });
    expect(diffNow["X-Portalai-Signature"]).not.toBe(
      baseline["X-Portalai-Signature"]
    );

    // Different body → different signature.
    const diffBody = signRequest(secret, "hello!", {
      now: 1779000000000,
      webhookId: "id-A",
    });
    expect(diffBody["X-Portalai-Signature"]).not.toBe(
      baseline["X-Portalai-Signature"]
    );
  });

  // Case 142
  it("generateSigningSecret produces unique whsec_-prefixed 256-bit secrets", () => {
    const a = generateSigningSecret();
    const b = generateSigningSecret();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^whsec_/);
    expect(b).toMatch(/^whsec_/);

    // 32 random bytes → base64url is at least ~43 chars without padding.
    const aBody = a.slice("whsec_".length);
    const decoded = Buffer.from(aBody, "base64url");
    expect(decoded.length).toBe(32);
  });
});
