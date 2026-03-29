/**
 * Integration tests for JobEventsService.
 *
 * Tests Redis Pub/Sub event publishing and subscription against a real Redis
 * instance from docker-compose. DB update calls are mocked since the
 * repository layer is already covered by its own integration tests.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { Redis } from "ioredis";

import type { JobUpdateEvent } from "@portalai/core/contracts";

// ── Shared Redis URL for tests ───────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

// ── Mock DbService to isolate Redis Pub/Sub behaviour ────────────────────

const mockJobsUpdate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: {
        update: mockJobsUpdate,
      },
    },
  },
}));

// ── Mock redis.util to return a controllable client ──────────────────────

let publisherClient: Redis;

jest.unstable_mockModule("../../../utils/redis.util.js", () => ({
  getRedisClient: () => publisherClient,
}));

// ── Dynamic import after mocks ───────────────────────────────────────────

let JobEventsService: typeof import("../../../services/job-events.service.js").JobEventsService;

beforeEach(async () => {
  publisherClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  mockJobsUpdate.mockClear();

  const mod = await import("../../../services/job-events.service.js");
  JobEventsService = mod.JobEventsService;
});

afterEach(async () => {
  await publisherClient.quit();
});

// ── Helpers ──────────────────────────────────────────────────────────────

let testId = 0;

function uniqueJobId(): string {
  return `test-job-${Date.now()}-${++testId}`;
}

/**
 * Create a dedicated subscriber that listens on a channel and collects
 * received events. Returns the collected events array and a cleanup fn.
 */
function createTestSubscriber(channel: string): {
  events: JobUpdateEvent[];
  ready: Promise<void>;
  cleanup: () => Promise<void>;
} {
  const sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const events: JobUpdateEvent[] = [];

  const ready = new Promise<void>((resolve) => {
    sub.subscribe(channel, () => resolve());
  });

  sub.on("message", (_ch: string, message: string) => {
    events.push(JSON.parse(message));
  });

  const cleanup = async () => {
    await sub.unsubscribe(channel);
    await sub.quit();
  };

  return { events, ready, cleanup };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("JobEventsService Integration Tests", () => {
  // ── transition() ─────────────────────────────────────────────────────

  describe("transition()", () => {
    it("should publish a job event to Redis Pub/Sub", async () => {
      const jobId = uniqueJobId();
      const channel = `job:events:${jobId}`;
      const { events, ready, cleanup } = createTestSubscriber(channel);

      await ready;

      await JobEventsService.transition(jobId, "active");

      // Allow message propagation
      await new Promise((r) => setTimeout(r, 200));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        jobId,
        status: "active",
        progress: 0,
      });
      expect(events[0].timestamp).toEqual(expect.any(Number));

      await cleanup();
    });

    it("should include patch fields in the published event", async () => {
      const jobId = uniqueJobId();
      const channel = `job:events:${jobId}`;
      const { events, ready, cleanup } = createTestSubscriber(channel);

      await ready;

      await JobEventsService.transition(jobId, "completed", {
        progress: 100,
        result: { rows: 42 },
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        jobId,
        status: "completed",
        progress: 100,
        result: { rows: 42 },
      });

      await cleanup();
    });

    it("should call DbService.repository.jobs.update before publishing", async () => {
      const jobId = uniqueJobId();
      const callOrder: string[] = [];

      mockJobsUpdate.mockImplementation(async () => {
        callOrder.push("db_update");
      });

      // Spy on publish to track ordering
      const origPublish = publisherClient.publish.bind(publisherClient);
      publisherClient.publish = async (...args: Parameters<typeof origPublish>) => {
        callOrder.push("redis_publish");
        return origPublish(...args);
      };

      await JobEventsService.transition(jobId, "active");

      expect(callOrder).toEqual(["db_update", "redis_publish"]);
      expect(mockJobsUpdate).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ status: "active", startedAt: expect.any(Number) })
      );
    });

    it("should set startedAt for active status", async () => {
      const jobId = uniqueJobId();

      await JobEventsService.transition(jobId, "active");

      expect(mockJobsUpdate).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ status: "active", startedAt: expect.any(Number) })
      );
    });

    it("should set completedAt for completed status", async () => {
      const jobId = uniqueJobId();

      await JobEventsService.transition(jobId, "completed");

      expect(mockJobsUpdate).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ status: "completed", completedAt: expect.any(Number) })
      );
    });

    it("should set completedAt for failed status", async () => {
      const jobId = uniqueJobId();

      await JobEventsService.transition(jobId, "failed", {
        error: "Something went wrong",
      });

      expect(mockJobsUpdate).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({
          status: "failed",
          completedAt: expect.any(Number),
          error: "Something went wrong",
        })
      );
    });
  });

  // ── updateProgress() ────────────────────────────────────────────────

  describe("updateProgress()", () => {
    it("should publish a progress event to Redis Pub/Sub", async () => {
      const jobId = uniqueJobId();
      const channel = `job:events:${jobId}`;
      const { events, ready, cleanup } = createTestSubscriber(channel);

      await ready;

      await JobEventsService.updateProgress(jobId, 50);

      await new Promise((r) => setTimeout(r, 200));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        jobId,
        status: "active",
        progress: 50,
      });

      await cleanup();
    });

    it("should update the database with progress", async () => {
      const jobId = uniqueJobId();

      await JobEventsService.updateProgress(jobId, 75);

      expect(mockJobsUpdate).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ progress: 75, updated: expect.any(Number) })
      );
    });
  });

  // ── subscribe() ─────────────────────────────────────────────────────

  describe("subscribe()", () => {
    it("should receive events published to the job channel", async () => {
      const jobId = uniqueJobId();
      const received: JobUpdateEvent[] = [];

      const cleanup = JobEventsService.subscribe(jobId, (event) => {
        received.push(event);
      });

      // Allow subscriber to connect
      await new Promise((r) => setTimeout(r, 300));

      // Publish directly via Redis
      const event: JobUpdateEvent = {
        jobId,
        status: "active",
        progress: 25,
        timestamp: Date.now(),
      };
      await publisherClient.publish(
        `job:events:${jobId}`,
        JSON.stringify(event)
      );

      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ jobId, status: "active", progress: 25 });

      cleanup();
    });

    it("should stop receiving events after cleanup", async () => {
      const jobId = uniqueJobId();
      const received: JobUpdateEvent[] = [];

      const cleanup = JobEventsService.subscribe(jobId, (event) => {
        received.push(event);
      });

      // Allow subscriber to connect
      await new Promise((r) => setTimeout(r, 300));

      // Cleanup the subscription
      cleanup();

      // Allow unsubscribe to propagate
      await new Promise((r) => setTimeout(r, 200));

      // Publish after cleanup
      const event: JobUpdateEvent = {
        jobId,
        status: "completed",
        progress: 100,
        timestamp: Date.now(),
      };
      await publisherClient.publish(
        `job:events:${jobId}`,
        JSON.stringify(event)
      );

      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(0);
    });
  });
});
