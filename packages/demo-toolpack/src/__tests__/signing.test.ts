import { sign, verifySignature } from "../signing.js";

const SECRET = "whsec_test_secret_alpha";
const OTHER = "whsec_test_secret_beta";
const NOW = 1_760_000_000; // fixed unix seconds
const ID = "11111111-1111-1111-1111-111111111111";
const BODY = JSON.stringify({
  tool: "credit_check",
  input: { customer_id: "CUST-00001" },
});

function verify(
  overrides: Partial<Parameters<typeof verifySignature>[0]> = {}
) {
  const ts = String(NOW);
  return verifySignature({
    timestamp: ts,
    webhookId: ID,
    signature: sign(SECRET, ts, ID, BODY),
    rawBody: BODY,
    secrets: [SECRET],
    nowSec: NOW,
    ...overrides,
  });
}

describe("verifySignature", () => {
  it("accepts a valid signature", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("accepts when the matching secret is anywhere in the allow-list", () => {
    expect(verify({ secrets: [OTHER, SECRET] })).toEqual({ ok: true });
  });

  it("rejects when no allow-list secret matches", () => {
    expect(verify({ secrets: [OTHER] })).toEqual({
      ok: false,
      status: 401,
      error: "SIGNATURE_INVALID",
    });
  });

  it("rejects an empty allow-list (fail-closed)", () => {
    expect(verify({ secrets: [] })).toEqual({
      ok: false,
      status: 401,
      error: "SIGNATURE_INVALID",
    });
  });

  it("rejects missing headers", () => {
    expect(verify({ signature: undefined }).ok).toBe(false);
    expect(verify({ timestamp: undefined })).toMatchObject({
      error: "SIGNATURE_MISSING",
    });
    expect(verify({ webhookId: undefined })).toMatchObject({
      error: "SIGNATURE_MISSING",
    });
  });

  it("rejects a stale or future timestamp", () => {
    expect(verify({ nowSec: NOW + 400 })).toMatchObject({
      error: "TIMESTAMP_STALE",
    });
    expect(verify({ nowSec: NOW - 120 })).toMatchObject({
      error: "TIMESTAMP_STALE",
    });
  });

  it("rejects a signature over a tampered body", () => {
    expect(verify({ rawBody: BODY + " " })).toMatchObject({
      error: "SIGNATURE_INVALID",
    });
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verify({ timestamp: "not-a-number" })).toMatchObject({
      error: "SIGNATURE_MISSING",
    });
  });
});
