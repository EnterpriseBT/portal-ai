/**
 * createDbPasswordResolver (#500) — the rotation-proof credential seam.
 * TTL-cached, single-flight, FAIL-OPEN (a stale password is the status quo,
 * never a new outage): fetch failure returns last-known-good, else the
 * DATABASE_URL's embedded password. Without a master-secret ARN the resolver
 * is a constant and the AWS SDK is never even constructed (local/dev/test).
 */

import { jest, it, expect, beforeEach, describe } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockSend = jest.fn<(command: unknown) => Promise<unknown>>();
const mockClientCtor = jest.fn(() => ({ send: mockSend }));
const mockCommandCtor = jest.fn((input: unknown) => ({ input }));
jest.unstable_mockModule("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: mockClientCtor,
  GetSecretValueCommand: mockCommandCtor,
}));

const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { createDbPasswordResolver } =
  await import("../../db/credentials.util.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const ARN = "arn:aws:secretsmanager:us-east-1:000000000000:secret:rds!db-test";

const secretPayload = (password: string) => ({
  SecretString: JSON.stringify({ username: "portalai", password }),
});

/** Deterministic clock the tests advance by hand. */
const makeClock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

beforeEach(() => {
  mockSend.mockReset();
  mockClientCtor.mockClear();
  mockCommandCtor.mockClear();
  mockWarn.mockReset();
});

// ── case 1 — no ARN: constant fallback, SDK never constructed ────────

describe("without a master-secret ARN", () => {
  it("returns the fallback and never constructs the SDK client", async () => {
    const resolver = createDbPasswordResolver({
      masterSecretArn: undefined,
      fallbackPassword: "url-pass",
    });

    await expect(resolver.resolve()).resolves.toBe("url-pass");
    await expect(resolver.resolve()).resolves.toBe("url-pass");
    expect(mockClientCtor).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });
});

// ── cases 2–8 — the fetching resolver ────────────────────────────────

describe("with a master-secret ARN", () => {
  it("fetches, parses {username,password}, and caches within the TTL (case 2)", async () => {
    const clock = makeClock();
    mockSend.mockResolvedValue(secretPayload("rotated-1"));
    const resolver = createDbPasswordResolver({
      masterSecretArn: ARN,
      fallbackPassword: "url-pass",
      now: clock.now,
    });

    await expect(resolver.resolve()).resolves.toBe("rotated-1");
    clock.advance(60_000); // inside the default 5-minute TTL
    await expect(resolver.resolve()).resolves.toBe("rotated-1");

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockCommandCtor).toHaveBeenCalledWith({ SecretId: ARN });
  });

  it("re-fetches past the TTL and warns 'rotation absorbed' when the password changed (case 3)", async () => {
    const clock = makeClock();
    mockSend
      .mockResolvedValueOnce(secretPayload("rotated-1"))
      .mockResolvedValueOnce(secretPayload("rotated-2"));
    const resolver = createDbPasswordResolver({
      masterSecretArn: ARN,
      fallbackPassword: "url-pass",
      now: clock.now,
    });

    await expect(resolver.resolve()).resolves.toBe("rotated-1");
    clock.advance(300_001); // past the default TTL
    await expect(resolver.resolve()).resolves.toBe("rotated-2");

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ secretArn: ARN }),
      expect.stringContaining("rotation absorbed")
    );
  });

  it("single-flights concurrent resolves into one fetch (case 4)", async () => {
    let release!: (v: unknown) => void;
    mockSend.mockReturnValue(new Promise((r) => (release = r)));
    const resolver = createDbPasswordResolver({
      masterSecretArn: ARN,
      fallbackPassword: "url-pass",
    });

    const inFlight = Promise.all(
      Array.from({ length: 5 }, () => resolver.resolve())
    );
    release(secretPayload("rotated-1"));

    await expect(inFlight).resolves.toEqual(Array(5).fill("rotated-1"));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("fails open: first-ever fetch failure returns the fallback; later failures return last-known-good (case 5)", async () => {
    const clock = makeClock();
    mockSend.mockRejectedValueOnce(new Error("throttled"));
    const resolver = createDbPasswordResolver({
      masterSecretArn: ARN,
      fallbackPassword: "url-pass",
      now: clock.now,
    });

    // First-ever fetch fails → fallback, warn, no rejection.
    await expect(resolver.resolve()).resolves.toBe("url-pass");
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ secretArn: ARN, cause: expect.anything() }),
      expect.any(String)
    );

    // A later success is cached…
    mockSend.mockResolvedValueOnce(secretPayload("rotated-1"));
    clock.advance(300_001);
    await expect(resolver.resolve()).resolves.toBe("rotated-1");

    // …and a subsequent failure serves last-known-good, not the fallback.
    mockSend.mockRejectedValueOnce(new Error("outage"));
    clock.advance(300_001);
    await expect(resolver.resolve()).resolves.toBe("rotated-1");
  });

  it("treats a secret without a password field as a failure (case 6)", async () => {
    mockSend.mockResolvedValue({
      SecretString: JSON.stringify({ username: "portalai" }),
    });
    const resolver = createDbPasswordResolver({
      masterSecretArn: ARN,
      fallbackPassword: "url-pass",
    });

    await expect(resolver.resolve()).resolves.toBe("url-pass");
    expect(mockWarn).toHaveBeenCalled();
  });

  it("invalidate() forces a re-fetch inside the TTL, keeping last-known-good as the floor (case 7)", async () => {
    const clock = makeClock();
    mockSend.mockResolvedValueOnce(secretPayload("rotated-1"));
    const resolver = createDbPasswordResolver({
      masterSecretArn: ARN,
      fallbackPassword: "url-pass",
      now: clock.now,
    });

    await expect(resolver.resolve()).resolves.toBe("rotated-1");
    resolver.invalidate();

    // Re-fetch fails → last-known-good survives the invalidation.
    mockSend.mockRejectedValueOnce(new Error("blip"));
    await expect(resolver.resolve()).resolves.toBe("rotated-1");
    expect(mockSend).toHaveBeenCalledTimes(2);

    // And a successful re-fetch replaces it.
    resolver.invalidate();
    mockSend.mockResolvedValueOnce(secretPayload("rotated-2"));
    await expect(resolver.resolve()).resolves.toBe("rotated-2");
  });

  it("honors a ttlMs override (case 8)", async () => {
    const clock = makeClock();
    mockSend
      .mockResolvedValueOnce(secretPayload("rotated-1"))
      .mockResolvedValueOnce(secretPayload("rotated-1"));
    const resolver = createDbPasswordResolver({
      masterSecretArn: ARN,
      fallbackPassword: "url-pass",
      ttlMs: 1_000,
      now: clock.now,
    });

    await resolver.resolve();
    clock.advance(999);
    await resolver.resolve();
    expect(mockSend).toHaveBeenCalledTimes(1);

    clock.advance(2);
    await resolver.resolve();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

// ── fallbackPasswordFromUrl — the fail-open floor extraction ──────────

describe("fallbackPasswordFromUrl", () => {
  it("decodes the URL's percent-encoded password", async () => {
    const { fallbackPasswordFromUrl } =
      await import("../../db/credentials.util.js");
    expect(fallbackPasswordFromUrl("postgresql://u:p%40ss%2Fw@h:5432/db")).toBe(
      "p@ss/w"
    );
  });

  it("yields an empty string for a malformed URL (no new boot failure mode)", async () => {
    const { fallbackPasswordFromUrl } =
      await import("../../db/credentials.util.js");
    expect(fallbackPasswordFromUrl("not a url")).toBe("");
    expect(fallbackPasswordFromUrl("")).toBe("");
  });
});
