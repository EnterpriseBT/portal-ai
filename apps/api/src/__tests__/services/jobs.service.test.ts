/**
 * JobsService.create builds a Job model and validates it against the full
 * JobSchema via `model.parse()` BEFORE the DB insert (jobs.service.ts). So
 * every required JobSchema field must be set at creation — the DB column
 * default does not help an in-memory parse. #464 added a required
 * `lostExecutions` field; omitting it here made `model.parse()` throw a
 * ZodError that surfaced to the client as
 * `[{ path: ["lostExecutions"], expected: "number", ... }]` on every sync.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockJobsCreate = jest.fn<
  (row: Record<string, unknown>) => Promise<unknown>
>(async (row) => ({ ...row, id: "job-1" }));
const mockJobsUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(
  async () => ({})
);
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { jobs: { create: mockJobsCreate, update: mockJobsUpdate } },
  },
}));

const mockAdd = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
  id: "bull-1",
}));
jest.unstable_mockModule("../../queues/jobs.queue.js", () => ({
  getJobsQueue: () => ({ add: mockAdd }),
  JOBS_QUEUE_NAME: "jobs",
}));

jest.unstable_mockModule("../../services/job-events.service.js", () => ({
  JobEventsService: { transition: jest.fn(async () => {}) },
}));

const { JobsService } = await import("../../services/jobs.service.js");

describe("JobsService.create — lost-execution field (#464)", () => {
  beforeEach(() => {
    mockJobsCreate.mockClear();
    mockJobsUpdate.mockClear();
    mockAdd.mockClear();
  });

  const params = {
    organizationId: "org-1",
    type: "connector_sync" as const,
    metadata: { connectorInstanceId: "ci-1" },
  };

  it("validates and persists a new job with lostExecutions: 0", async () => {
    // Before the fix, `model.parse()` inside create() threw a ZodError here
    // because lostExecutions was undefined.
    await expect(JobsService.create("user-1", params)).resolves.toBeDefined();

    const inserted = mockJobsCreate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(inserted.lostExecutions).toBe(0);
    // Sanity: the rest of the creation contract is intact.
    expect(inserted.status).toBe("pending");
    expect(inserted.attempts).toBe(0);
  });
});
