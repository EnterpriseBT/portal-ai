/**
 * GET /api/sse/portals/:portalId/stream — the #504 reconnect guard at the
 * route level.
 *
 * The bug: an EventSource that drops mid-turn auto-reconnects and re-invokes
 * this route, firing a duplicate Anthropic call for the same turn. These tests
 * pin the router's branching — already-answered / in-flight / fresh — so a
 * reconnect can never reach `streamResponse` (the sole path to the model) for
 * a turn that is already being answered or already answered.
 *
 * PortalService and PortalTurnGuardService are mocked so the branches are
 * driven deterministically; the guard's own Redis NX correctness is covered by
 * its unit test.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";

// ── Mocks ────────────────────────────────────────────────────────────

const mockGetPortal = jest.fn<() => Promise<unknown>>();
const mockStreamResponse = jest.fn<() => Promise<void>>();
const mockReplayTurn =
  jest.fn<(sse: unknown, msg: unknown, portalId: string) => void>();
const mockBuildStationContext = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/portal.service.js", () => ({
  PortalService: {
    getPortal: mockGetPortal,
    streamResponse: mockStreamResponse,
    replayTurn: mockReplayTurn,
  },
  buildStationContext: mockBuildStationContext,
}));

const mockTurnLockKey = jest.fn<(p: string, m: string) => string>(
  (p, m) => `portal-turn:${p}:${m}`
);
const mockAcquire = jest.fn<() => Promise<boolean>>();
const mockRelease = jest.fn<() => Promise<void>>();
const mockWaitForAnswer = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/portal-turn-guard.service.js", () => ({
  PortalTurnGuardService: {
    turnLockKey: mockTurnLockKey,
    acquireTurnLock: mockAcquire,
    releaseTurnLock: mockRelease,
    waitForAnswer: mockWaitForAnswer,
  },
}));

const mockStationFindById = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stations: { findById: mockStationFindById },
      portals: { findById: jest.fn() },
    },
  },
}));

jest.unstable_mockModule("../../middleware/sse-auth.middleware.js", () => ({
  sseAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// #685: the caller is resolved like REST, and the portal must be accessible.
const CALLER = { userId: "caller-1", organizationId: "org-1", roles: [] };
jest.unstable_mockModule("../../middleware/metadata.middleware.js", () => ({
  getApplicationMetadata: (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    (req as unknown as { application: unknown }).application = {
      metadata: CALLER,
    };
    next();
  },
}));
const mockWriteCheck = jest.fn<(action: string, object: unknown) => void>();
const mockAccessLoad = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/portal-access.service.js", () => ({
  PortalAccessService: {
    load: mockAccessLoad,
    object: (p: { id: string; createdBy: string }) => ({
      type: "portal",
      id: p.id,
      createdBy: p.createdBy,
    }),
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

const { portalEventsRouter } =
  await import("../../routes/portal-events.router.js");
const { ApiError } = await import("../../services/http.service.js");

// ── App setup ────────────────────────────────────────────────────────

const app = express();
app.use("/api/sse/portals", portalEventsRouter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.status ?? 500).json({
    success: false,
    code: err.code ?? "UNKNOWN",
    message: err.message,
  });
});

// ── Fixtures ─────────────────────────────────────────────────────────

const PORTAL_ID = "portal-1";
const STREAM_URL = `/api/sse/portals/${PORTAL_ID}/stream?token=t`;

const PORTAL = {
  id: PORTAL_ID,
  stationId: "station-1",
  organizationId: "org-1",
  createdBy: "user-1",
};
// The pending user message's author (who posted it via POST /messages).
const USER_ROW = { id: "u1", role: "user", blocks: [], createdBy: "author-1" };
const ASSISTANT_ROW = {
  id: "a1",
  role: "assistant",
  blocks: [{ type: "text", content: "hi" }],
};

const pendingTurn = {
  portal: PORTAL,
  messages: [USER_ROW],
  coreMessages: [{ role: "user", content: "hi" }],
};
const answeredTurn = {
  portal: PORTAL,
  messages: [USER_ROW, ASSISTANT_ROW],
  coreMessages: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStationFindById.mockResolvedValue({ id: "station-1", name: "Station" });
  mockBuildStationContext.mockResolvedValue({ stationId: "station-1" });
  mockStreamResponse.mockResolvedValue();
  mockRelease.mockResolvedValue();
  mockAccessLoad.mockResolvedValue({
    portal: PORTAL,
    set: { check: mockWriteCheck },
  });
});

// ── Already answered — replay, no model ──────────────────────────────

describe("reconnect after the turn is answered", () => {
  it("replays the persisted assistant message and never calls the model or the lock", async () => {
    mockGetPortal.mockResolvedValue(answeredTurn);

    const res = await request(app).get(STREAM_URL);

    expect(res.status).toBe(200);
    expect(mockReplayTurn).toHaveBeenCalledTimes(1);
    // The replayed message is the persisted assistant row.
    expect(mockReplayTurn.mock.calls[0][1]).toEqual(ASSISTANT_ROW);
    expect(mockStreamResponse).not.toHaveBeenCalled();
    expect(mockAcquire).not.toHaveBeenCalled();
  });
});

// ── Fresh turn — generate once, release the lock ─────────────────────

describe("fresh pending turn", () => {
  it("acquires the lock, streams the response, and releases the lock", async () => {
    mockGetPortal.mockResolvedValue(pendingTurn);
    mockAcquire.mockResolvedValue(true);

    await request(app).get(STREAM_URL);

    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockStreamResponse).toHaveBeenCalledTimes(1);
    expect(mockReplayTurn).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

// ── #685: identity + access ──────────────────────────────────────────

describe("authorization (#685)", () => {
  it("a fresh turn runs as the pending message's author, not the stream caller or the portal's creator", async () => {
    mockGetPortal.mockResolvedValue(pendingTurn);
    mockAcquire.mockResolvedValue(true);

    await request(app).get(STREAM_URL);

    expect(mockAccessLoad).toHaveBeenCalledWith(CALLER, PORTAL_ID);
    expect(mockWriteCheck).toHaveBeenCalledWith("resource.write", {
      type: "portal",
      id: PORTAL_ID,
      createdBy: "user-1",
    });
    // The caller (an owner/admin can open any portal's stream) only claims
    // the turn; its data access is the author's, so a reply never carries
    // rows the author can't see into the author's portal.
    expect(mockBuildStationContext.mock.calls[0]).toEqual([
      expect.objectContaining({ userId: "author-1" }),
    ]);
    expect(mockStreamResponse.mock.calls[0]).toEqual([
      expect.objectContaining({ userId: "author-1" }),
    ]);
  });

  it("an inaccessible portal is refused before anything is read or streamed", async () => {
    mockAccessLoad.mockRejectedValue(
      new ApiError(404, "PORTAL_NOT_FOUND" as never, "Portal not found")
    );

    const res = await request(app).get(STREAM_URL);

    expect(res.status).toBe(404);
    expect(mockGetPortal).not.toHaveBeenCalled();
    expect(mockStreamResponse).not.toHaveBeenCalled();
  });

  it("a caller who can read but not write the portal can't run a turn (403)", async () => {
    mockGetPortal.mockResolvedValue(pendingTurn);
    mockAcquire.mockResolvedValue(true);
    mockWriteCheck.mockImplementationOnce(() => {
      throw new ApiError(403, "PERMISSION_DENIED" as never, "Forbidden");
    });

    const res = await request(app).get(STREAM_URL);

    expect(res.status).toBe(403);
    expect(mockStreamResponse).not.toHaveBeenCalled();
    // The turn lock is still released.
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

// ── The idempotency guarantee ────────────────────────────────────────

describe("concurrent reconnect for the same in-flight turn", () => {
  it("fires exactly one model call across two GETs — the second replays", async () => {
    mockGetPortal.mockResolvedValue(pendingTurn);
    // First GET wins the lock; the reconnect finds it held.
    mockAcquire.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockWaitForAnswer.mockResolvedValue(ASSISTANT_ROW);

    await request(app).get(STREAM_URL);
    await request(app).get(STREAM_URL);

    // The bug was two model calls; the guard makes it exactly one.
    expect(mockStreamResponse).toHaveBeenCalledTimes(1);
    // The reconnect replayed the in-flight turn's persisted answer instead.
    expect(mockWaitForAnswer).toHaveBeenCalledTimes(1);
    expect(mockReplayTurn).toHaveBeenCalledTimes(1);
    expect(mockReplayTurn.mock.calls[0][1]).toEqual(ASSISTANT_ROW);
  });

  it("surfaces a 'still answering' notice when the in-flight turn does not land in time", async () => {
    mockGetPortal.mockResolvedValue(pendingTurn);
    mockAcquire.mockResolvedValue(false);
    mockWaitForAnswer.mockResolvedValue(null); // timed out waiting

    const res = await request(app).get(STREAM_URL);

    expect(mockStreamResponse).not.toHaveBeenCalled();
    expect(mockReplayTurn).not.toHaveBeenCalled();
    // sendError writes a stream_error event over the SSE body.
    expect(res.text).toContain("stream_error");
    expect(res.text).toContain("still being answered");
  });
});
