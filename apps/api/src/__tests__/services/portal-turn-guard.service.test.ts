/**
 * PortalTurnGuardService (#504) — the cross-instance turn lock + bounded wait
 * that stops an EventSource reconnect from firing a duplicate Anthropic call.
 *
 * The Redis client factory is mocked; `withRedisTimeout` runs for real so the
 * fail-open path is exercised through the actual wrapper.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks (before dynamic import) ────────────────────────────────────

const mockSet = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockDel = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({ set: mockSet, del: mockDel }),
}));

const mockFindByPortal = jest.fn<(portalId: string) => Promise<unknown[]>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { portalMessages: { findByPortal: mockFindByPortal } },
  },
}));

jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { PortalTurnGuardService, TURN_LOCK_TTL_MS } =
  await import("../../services/portal-turn-guard.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const userRow = { id: "msg-user-1", role: "user", blocks: [] };
const assistantRow = { id: "msg-asst-1", role: "assistant", blocks: [] };

beforeEach(() => {
  mockSet.mockReset();
  mockDel.mockReset();
  mockFindByPortal.mockReset();
});

// ── turnLockKey ──────────────────────────────────────────────────────

describe("turnLockKey", () => {
  it("namespaces the key by portal and pending user-message id", () => {
    expect(PortalTurnGuardService.turnLockKey("portal-1", "msg-user-1")).toBe(
      "portal-turn:portal-1:msg-user-1"
    );
  });
});

// ── acquireTurnLock ──────────────────────────────────────────────────

describe("acquireTurnLock", () => {
  it("claims the turn (SET NX PX) and returns true when Redis replies OK", async () => {
    mockSet.mockResolvedValue("OK");

    const acquired = await PortalTurnGuardService.acquireTurnLock("k");

    expect(acquired).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      "k",
      "1",
      "PX",
      TURN_LOCK_TTL_MS,
      "NX"
    );
  });

  it("returns false when the key already exists (Redis replies null)", async () => {
    mockSet.mockResolvedValue(null);

    expect(await PortalTurnGuardService.acquireTurnLock("k")).toBe(false);
  });

  it("fails OPEN (true) when Redis errors — never blocks a turn", async () => {
    mockSet.mockRejectedValue(new Error("redis down"));

    expect(await PortalTurnGuardService.acquireTurnLock("k")).toBe(true);
  });
});

// ── releaseTurnLock ──────────────────────────────────────────────────

describe("releaseTurnLock", () => {
  it("deletes the key", async () => {
    mockDel.mockResolvedValue(1);

    await PortalTurnGuardService.releaseTurnLock("k");

    expect(mockDel).toHaveBeenCalledWith("k");
  });

  it("swallows a Redis error (TTL is the backstop)", async () => {
    mockDel.mockRejectedValue(new Error("redis down"));

    await expect(
      PortalTurnGuardService.releaseTurnLock("k")
    ).resolves.toBeUndefined();
  });
});

// ── waitForAnswer ────────────────────────────────────────────────────

describe("waitForAnswer", () => {
  it("returns the assistant message once the newest row is an answer", async () => {
    mockFindByPortal.mockResolvedValue([userRow, assistantRow]);

    const answer = await PortalTurnGuardService.waitForAnswer("portal-1", {
      intervalMs: 1,
      maxAttempts: 3,
    });

    expect(answer).toEqual(assistantRow);
    expect(mockFindByPortal).toHaveBeenCalledTimes(1);
  });

  it("polls until the answer lands, then returns it", async () => {
    mockFindByPortal
      .mockResolvedValueOnce([userRow]) // still pending
      .mockResolvedValueOnce([userRow]) // still pending
      .mockResolvedValueOnce([userRow, assistantRow]); // answered

    const answer = await PortalTurnGuardService.waitForAnswer("portal-1", {
      intervalMs: 1,
      maxAttempts: 5,
    });

    expect(answer).toEqual(assistantRow);
    expect(mockFindByPortal).toHaveBeenCalledTimes(3);
  });

  it("returns null after the poll ceiling when no answer ever lands", async () => {
    mockFindByPortal.mockResolvedValue([userRow]);

    const answer = await PortalTurnGuardService.waitForAnswer("portal-1", {
      intervalMs: 1,
      maxAttempts: 4,
    });

    expect(answer).toBeNull();
    expect(mockFindByPortal).toHaveBeenCalledTimes(4);
  });
});
