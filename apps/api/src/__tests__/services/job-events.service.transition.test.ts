/**
 * `JobEventsService.transition`'s DB patch (#441 slice 1).
 *
 * Two things about this method are load-bearing and neither is visible from
 * its signature:
 *
 *  - **`error` must be settable to `null`.** Drizzle omits `undefined` from a
 *    `SET`, so passing `undefined` to clear a stale error silently keeps the
 *    old text — which is exactly the reported bug: a retried job read
 *    `status=active, progress=88, error="Fetch failed: fetch failed"`, still
 *    carrying the *previous* attempt's failure. Clearing therefore has to be
 *    an explicit `null`, and the patch type has to allow it.
 *  - **Omitting `error` must still leave the column untouched.** Every other
 *    caller relies on that, so widening the type must not turn a missing key
 *    into a null write.
 *
 * `attempts` is added here for the same reason it was missing: nothing could
 * record it, so `jobs.attempts` sat at 0 through every retry in the ticket's
 * evidence.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockUpdateWhere = jest.fn<(...a: unknown[]) => Promise<unknown[]>>();
const mockPublish = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: { update: mockUpdate, updateWhere: mockUpdateWhere },
    },
  },
}));

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    publish: mockPublish,
    duplicate: () => ({ on: () => undefined }),
  }),
}));

const NOW = 1_800_000_000_000;
jest.unstable_mockModule("../../utils/system.util.js", () => ({
  SystemUtilities: { utc: { now: () => new Date(NOW) } },
}));

const { JobEventsService } =
  await import("../../services/job-events.service.js");

/** The patch object handed to `jobs.update`. */
const patchFor = (call = 0) =>
  mockUpdate.mock.calls[call][1] as Record<string, unknown>;

/** The event published to Redis. */
const eventFor = (call = 0) =>
  JSON.parse(mockPublish.mock.calls[call][1] as string) as Record<
    string,
    unknown
  >;

describe("JobEventsService.transition — DB patch (#441)", () => {
  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue(undefined);
    mockPublish.mockReset().mockResolvedValue(1);
  });

  it("writes error: null when asked to clear it", async () => {
    await JobEventsService.transition("job-1", "active", {
      progress: 0,
      error: null,
    });

    const patch = patchFor();
    // The key must be PRESENT and null — `undefined` would be dropped by
    // Drizzle's SET builder and the stale text would survive.
    expect("error" in patch).toBe(true);
    expect(patch.error).toBeNull();
  });

  it("leaves the error column untouched when error is omitted", async () => {
    await JobEventsService.transition("job-1", "active", { progress: 0 });

    expect("error" in patchFor()).toBe(false);
  });

  it("persists attempts", async () => {
    await JobEventsService.transition("job-1", "active", {
      progress: 0,
      attempts: 2,
    });

    expect(patchFor().attempts).toBe(2);
  });

  it("does not touch attempts when omitted", async () => {
    await JobEventsService.transition("job-1", "active", { progress: 0 });

    expect("attempts" in patchFor()).toBe(false);
  });

  it("still stamps startedAt on active and completedAt on terminal statuses", async () => {
    await JobEventsService.transition("job-1", "active", { progress: 0 });
    expect(patchFor(0).startedAt).toBe(NOW);
    expect("completedAt" in patchFor(0)).toBe(false);

    await JobEventsService.transition("job-1", "failed", { error: "boom" });
    expect(patchFor(1).completedAt).toBe(NOW);
  });

  it("does not stamp completedAt on a non-terminal status", async () => {
    // The retry path writes `pending`, and a job about to run again must not
    // carry a completion time — today's premature `failed` produced a row
    // reading "completed at 18:35" and "active at 18:50".
    await JobEventsService.transition("job-1", "pending", {
      error: "attempt 1 failed",
    });

    expect("completedAt" in patchFor()).toBe(false);
  });

  it("publishes error as null rather than dropping the field", async () => {
    await JobEventsService.transition("job-1", "active", {
      progress: 0,
      error: null,
    });

    const event = eventFor();
    expect(event.error).toBeNull();
    expect(event.status).toBe("active");
  });

  it("publishes the error text on a failure transition", async () => {
    await JobEventsService.transition("job-1", "pending", {
      error: "Fetch failed",
    });

    expect(eventFor().error).toBe("Fetch failed");
  });
});

// ── transitionIfNonTerminal (#391) ───────────────────────────────────

describe("JobEventsService.transitionIfNonTerminal (#391)", () => {
  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue(undefined);
    mockUpdateWhere.mockReset();
    mockPublish.mockReset().mockResolvedValue(1);
  });

  /** The patch handed to `jobs.updateWhere` (second positional arg). */
  const wherePatch = (call = 0) =>
    mockUpdateWhere.mock.calls[call][1] as Record<string, unknown>;

  it("writes, stamps completedAt on failed, publishes, and returns true when the row is non-terminal", async () => {
    mockUpdateWhere.mockResolvedValue([{ id: "job-1" }]); // guarded write landed

    const did = await JobEventsService.transitionIfNonTerminal(
      "job-1",
      "failed",
      { error: "Stranded: test reason" }
    );

    expect(did).toBe(true);
    const patch = wherePatch();
    expect(patch.status).toBe("failed");
    expect(patch.completedAt).toBe(NOW);
    expect(patch.updated).toBe(NOW);
    expect(patch.error).toBe("Stranded: test reason");
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(eventFor().status).toBe("failed");
  });

  it("returns false and publishes nothing when a terminal status already stands", async () => {
    mockUpdateWhere.mockResolvedValue([]); // guard matched no row

    const did = await JobEventsService.transitionIfNonTerminal(
      "job-1",
      "failed",
      { error: "too late" }
    );

    // First terminal writer wins — a losing writer must not broadcast a
    // status the row never took.
    expect(did).toBe(false);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("still returns true when the publish throws — the row is the record of truth", async () => {
    mockUpdateWhere.mockResolvedValue([{ id: "job-1" }]);
    mockPublish.mockRejectedValue(new Error("redis is down"));

    // Redis being down is the very failure mode the caller (the stranded-job
    // sweep) exists to repair — the notification must never undo the repair.
    await expect(
      JobEventsService.transitionIfNonTerminal("job-1", "failed", {
        error: "x",
      })
    ).resolves.toBe(true);
  });

  it("matches transition's patch semantics: omitted error leaves the column untouched", async () => {
    mockUpdateWhere.mockResolvedValue([{ id: "job-1" }]);

    await JobEventsService.transitionIfNonTerminal("job-1", "active", {
      progress: 5,
    });

    const patch = wherePatch();
    expect("error" in patch).toBe(false);
    expect(patch.startedAt).toBe(NOW); // active stamps startedAt, like transition
  });
});
