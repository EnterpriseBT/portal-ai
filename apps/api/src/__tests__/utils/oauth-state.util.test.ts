import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import crypto from "crypto";
import { environment } from "../../environment.js";
import {
  signState,
  verifyState,
  OAuthStateError,
  STATE_TTL_MS,
} from "../../utils/oauth-state.util.js";

const TEST_SECRET = crypto.randomBytes(32).toString("base64");
let originalSecret: string;

beforeAll(() => {
  originalSecret = environment.OAUTH_STATE_SECRET;
  environment.OAUTH_STATE_SECRET = TEST_SECRET;
});

afterAll(() => {
  environment.OAUTH_STATE_SECRET = originalSecret;
});

describe("signState / verifyState", () => {
  it("round-trips userId + organizationId", () => {
    const token = signState({ userId: "u1", organizationId: "o1" });
    expect(verifyState(token)).toEqual({ userId: "u1", organizationId: "o1" });
  });

  it("produces different tokens for the same payload (fresh nonce)", () => {
    const a = signState({ userId: "u1", organizationId: "o1" });
    const b = signState({ userId: "u1", organizationId: "o1" });
    expect(a).not.toBe(b);
  });

  it("token has a payload.signature shape (two base64url-ish segments)", () => {
    const token = signState({ userId: "u1", organizationId: "o1" });
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]?.length).toBeGreaterThan(0);
    expect(parts[1]?.length).toBeGreaterThan(0);
  });
});

describe("verifyState — tamper detection", () => {
  it("throws OAuthStateError('invalid') when payload is tampered", () => {
    const token = signState({ userId: "u1", organizationId: "o1" });
    const [payload, sig] = token.split(".") as [string, string];
    const tamperedPayload =
      payload.slice(0, -2) +
      (payload.at(-2) === "A" ? "B" : "A") +
      payload.at(-1);
    expect(() => verifyState(`${tamperedPayload}.${sig}`)).toThrow(
      OAuthStateError
    );
    try {
      verifyState(`${tamperedPayload}.${sig}`);
    } catch (err) {
      expect((err as OAuthStateError).kind).toBe("invalid");
    }
  });

  it("throws OAuthStateError('invalid') when signature is tampered", () => {
    const token = signState({ userId: "u1", organizationId: "o1" });
    const [payload, sig] = token.split(".") as [string, string];
    const tamperedSig =
      sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
    try {
      verifyState(`${payload}.${tamperedSig}`);
      throw new Error("expected verifyState to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError);
      expect((err as OAuthStateError).kind).toBe("invalid");
    }
  });

  it("throws OAuthStateError('invalid') when the token is malformed", () => {
    try {
      verifyState("not-a-valid-token");
      throw new Error("expected verifyState to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError);
      expect((err as OAuthStateError).kind).toBe("invalid");
    }
  });
});

describe("verifyState — expiry", () => {
  it("throws OAuthStateError('expired') after STATE_TTL_MS", () => {
    const t0 = 1_700_000_000_000;
    const token = signState(
      { userId: "u1", organizationId: "o1" },
      { now: () => t0 }
    );
    try {
      verifyState(token, { now: () => t0 + STATE_TTL_MS + 1 });
      throw new Error("expected verifyState to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError);
      expect((err as OAuthStateError).kind).toBe("expired");
    }
  });

  it("accepts the token at exactly STATE_TTL_MS", () => {
    const t0 = 1_700_000_000_000;
    const token = signState(
      { userId: "u1", organizationId: "o1" },
      { now: () => t0 }
    );
    expect(verifyState(token, { now: () => t0 + STATE_TTL_MS })).toEqual({
      userId: "u1",
      organizationId: "o1",
    });
  });
});

describe("verifyState — wrong secret", () => {
  it("throws OAuthStateError('invalid') when the secret has changed", () => {
    const token = signState({ userId: "u1", organizationId: "o1" });
    const original = environment.OAUTH_STATE_SECRET;
    environment.OAUTH_STATE_SECRET = crypto.randomBytes(32).toString("base64");
    try {
      verifyState(token);
      throw new Error("expected verifyState to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError);
      expect((err as OAuthStateError).kind).toBe("invalid");
    } finally {
      environment.OAUTH_STATE_SECRET = original;
    }
  });
});

describe("signState — input validation", () => {
  it("rejects empty userId", () => {
    expect(() =>
      signState({ userId: "", organizationId: "o1" })
    ).toThrow(/userId/);
  });

  it("rejects empty organizationId", () => {
    expect(() =>
      signState({ userId: "u1", organizationId: "" })
    ).toThrow(/organizationId/);
  });

  it("throws when OAUTH_STATE_SECRET is empty", () => {
    const original = environment.OAUTH_STATE_SECRET;
    environment.OAUTH_STATE_SECRET = "";
    try {
      expect(() =>
        signState({ userId: "u1", organizationId: "o1" })
      ).toThrow(/OAUTH_STATE_SECRET/);
    } finally {
      environment.OAUTH_STATE_SECRET = original;
    }
  });
});
