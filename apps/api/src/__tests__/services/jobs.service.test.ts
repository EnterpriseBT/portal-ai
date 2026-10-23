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
  (row: Record<string, unknown>, client?: unknown) => Promise<unknown>
>(async (row) => ({ ...row, id: "job-1" }));
const mockJobsUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(
  async () => ({})
);
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { jobs: { create: mockJobsCreate, update: mockJobsUpdate } },
  },
}));

// Like BullMQ: a custom `jobId` option becomes the job's id; otherwise the
// queue assigns its own (sequential) one.
const mockAdd = jest.fn<(...a: unknown[]) => Promise<unknown>>(
  async (_name, _data, opts) => ({
    id: (opts as { jobId?: string } | undefined)?.jobId ?? "bull-1",
  })
);
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

  // A job type that locks nothing, so plain `create` accepts it (#769).
  const params = {
    organizationId: "org-1",
    type: "system_check" as const,
    metadata: {},
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

describe("JobsService.insertRow / dispatch (#769)", () => {
  beforeEach(() => {
    mockJobsCreate.mockClear();
    mockJobsUpdate.mockClear();
    mockAdd.mockClear();
  });

  it("stores the job's lock scopes from the core registry", async () => {
    await JobsService.insertRow("user-1", {
      organizationId: "org-1",
      type: "bulk_transform",
      metadata: {
        sourceConnectorEntityId: "src",
        targetConnectorEntityIds: ["t1"],
      },
    });

    const inserted = mockJobsCreate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(inserted.lockScopes).toEqual(["entity:t1", "entity:src"]);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("inserts on the client it is given", async () => {
    await JobsService.insertRow(
      "user-1",
      { organizationId: "org-1", type: "system_check", metadata: {} },
      "mock-tx" as never
    );
    expect(mockJobsCreate.mock.calls[0]![1]).toBe("mock-tx");
  });

  it("create is insertRow + dispatch: an unscoped job gets [] and is queued", async () => {
    const job = await JobsService.create("user-1", {
      organizationId: "org-1",
      type: "system_check",
      metadata: {},
    });
    expect(
      (mockJobsCreate.mock.calls[0]![0] as { lockScopes: string[] }).lockScopes
    ).toEqual([]);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(job.bullJobId).toBe("job-1");
  });
});

describe("JobsService.dispatch — the BullMQ id is the row id (#852)", () => {
  beforeEach(() => {
    mockJobsCreate.mockClear();
    mockJobsUpdate.mockClear();
    mockAdd.mockClear();
  });

  // BullMQ's own ids are a per-Redis counter, so a fresh Redis restarts at 1
  // and an old row's stored id would name an unrelated job there. The row id
  // is unique forever, and re-adding it is a no-op BullMQ ignores.
  it("adds with jobId: job.id and the row's attempt budget", async () => {
    await JobsService.create("user-1", {
      organizationId: "org-1",
      type: "system_check",
      metadata: {},
    });
    expect(mockAdd).toHaveBeenCalledWith(
      "system_check",
      expect.objectContaining({ jobId: "job-1", type: "system_check" }),
      { jobId: "job-1", attempts: expect.any(Number) }
    );
  });

  it("stores bullJobId equal to the row id", async () => {
    await JobsService.create("user-1", {
      organizationId: "org-1",
      type: "system_check",
      metadata: {},
    });
    expect(mockJobsUpdate).toHaveBeenCalledWith("job-1", {
      bullJobId: "job-1",
    });
  });
});

describe("JobsService.create refuses a job that locks scopes (#769)", () => {
  beforeEach(() => {
    mockJobsCreate.mockClear();
    mockAdd.mockClear();
  });

  it("a scoped job must start through JobLockService.enqueueExclusive", async () => {
    await expect(
      JobsService.create("user-1", {
        organizationId: "org-1",
        type: "revalidation",
        metadata: { connectorEntityId: "ce-1" },
      })
    ).rejects.toThrow(/enqueueExclusive/);
    expect(mockJobsCreate).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe("JobsService.queuePayload — the row's identity always wins (#852 adversarial)", () => {
  const job = (metadata: Record<string, unknown>) =>
    ({
      id: "row-1",
      type: "system_check",
      metadata,
      maxAttempts: 3,
    }) as never;

  it("metadata can't override jobId or type", () => {
    const data = JobsService.queuePayload(
      job({ jobId: "other-row", type: "bulk_transform", foo: 1 })
    );
    expect(data).toEqual({ jobId: "row-1", type: "system_check", foo: 1 });
  });

  it("metadata can't set attemptOffset; only the re-dispatch's value counts", () => {
    expect(JobsService.queuePayload(job({ attemptOffset: -5 }))).toEqual({
      jobId: "row-1",
      type: "system_check",
    });
    expect(
      JobsService.queuePayload(job({ attemptOffset: -5 }), {
        attemptOffset: 2,
      })
    ).toMatchObject({ attemptOffset: 2 });
  });
});
