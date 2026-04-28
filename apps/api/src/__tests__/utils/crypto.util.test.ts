import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import crypto from "crypto";
import { environment } from "../../environment.js";
import {
  encryptCredentials,
  decryptCredentials,
} from "../../utils/crypto.util.js";

// A valid base64-encoded 32-byte key for testing
const TEST_KEY = crypto.randomBytes(32).toString("base64");

let originalKey: string | undefined;

beforeAll(() => {
  originalKey = environment.ENCRYPTION_KEY;
  environment.ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  environment.ENCRYPTION_KEY = originalKey;
});

// ── Round-trip ──────────────────────────────────────────────────────

describe("encryptCredentials / decryptCredentials", () => {
  it("round-trips a simple object", () => {
    const input = { username: "admin", password: "s3cret" };
    const blob = encryptCredentials(input);
    expect(decryptCredentials(blob)).toEqual(input);
  });

  it("round-trips an empty object", () => {
    const input = {};
    expect(decryptCredentials(encryptCredentials(input))).toEqual(input);
  });

  it("round-trips nested and mixed-type values", () => {
    const input = {
      token: "abc-123",
      nested: { a: 1, b: [true, null, "x"] },
      count: 42,
    };
    expect(decryptCredentials(encryptCredentials(input))).toEqual(input);
  });

  it("produces different ciphertexts for the same plaintext (unique IV)", () => {
    const input = { key: "value" };
    const a = encryptCredentials(input);
    const b = encryptCredentials(input);
    expect(a).not.toBe(b);
  });
});

// ── encryptCredentials ─────────────────────────────────────────────

describe("encryptCredentials", () => {
  it("returns a valid JSON string", () => {
    const blob = encryptCredentials({ a: 1 });
    expect(() => JSON.parse(blob)).not.toThrow();
  });

  it("payload contains iv, authTag, data, and v fields", () => {
    const blob = encryptCredentials({ a: 1 });
    const payload = JSON.parse(blob);
    expect(payload).toHaveProperty("iv");
    expect(payload).toHaveProperty("authTag");
    expect(payload).toHaveProperty("data");
    expect(payload).toHaveProperty("v", 1);
  });

  it("payload fields are base64-encoded strings", () => {
    const blob = encryptCredentials({ a: 1 });
    const { iv, authTag, data } = JSON.parse(blob);
    const b64 = /^[A-Za-z0-9+/]+=*$/;
    expect(iv).toMatch(b64);
    expect(authTag).toMatch(b64);
    expect(data).toMatch(b64);
  });

  it("does not contain plaintext credentials in the blob", () => {
    const secret = "super-secret-token-value";
    const blob = encryptCredentials({ token: secret });
    expect(blob).not.toContain(secret);
  });
});

// ── decryptCredentials ─────────────────────────────────────────────

describe("decryptCredentials", () => {
  it("throws on tampered ciphertext", () => {
    const blob = encryptCredentials({ a: 1 });
    const payload = JSON.parse(blob);
    // Flip a character in the encrypted data
    payload.data =
      payload.data.slice(0, -2) +
      (payload.data.at(-2) === "A" ? "B" : "A") +
      payload.data.at(-1);
    expect(() => decryptCredentials(JSON.stringify(payload))).toThrow();
  });

  it("throws on tampered authTag", () => {
    const blob = encryptCredentials({ a: 1 });
    const payload = JSON.parse(blob);
    payload.authTag = crypto.randomBytes(16).toString("base64");
    expect(() => decryptCredentials(JSON.stringify(payload))).toThrow();
  });

  it("throws on invalid JSON input", () => {
    expect(() => decryptCredentials("not-json")).toThrow();
  });
});

// ── Key validation ─────────────────────────────────────────────────

describe("key validation", () => {
  it("throws when ENCRYPTION_KEY is missing", () => {
    const saved = environment.ENCRYPTION_KEY;
    environment.ENCRYPTION_KEY = undefined;
    try {
      expect(() => encryptCredentials({ a: 1 })).toThrow(
        "ENCRYPTION_KEY is not configured"
      );
    } finally {
      environment.ENCRYPTION_KEY = saved;
    }
  });

  it("throws when ENCRYPTION_KEY decodes to wrong length", () => {
    const saved = environment.ENCRYPTION_KEY;
    environment.ENCRYPTION_KEY = crypto.randomBytes(16).toString("base64");
    try {
      expect(() => encryptCredentials({ a: 1 })).toThrow(
        "must decode to exactly 32 bytes"
      );
    } finally {
      environment.ENCRYPTION_KEY = saved;
    }
  });
});
