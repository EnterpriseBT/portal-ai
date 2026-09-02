import {
  JobSnapshotEventSchema,
  JobUpdateEventSchema,
} from "../../contracts/job.contract.js";

// #458 — the SSE event schemas carry the structured progress detail so a
// reconnecting client sees the same counts as the live stream.

const baseSnapshot = {
  jobId: "job-1",
  status: "active" as const,
  progress: 40,
  error: null,
  result: null,
  startedAt: 1000,
  completedAt: null,
};

describe("JobSnapshotEventSchema.progressDetail (#458)", () => {
  it("accepts a null progressDetail", () => {
    const result = JobSnapshotEventSchema.safeParse({
      ...baseSnapshot,
      progressDetail: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a populated progressDetail", () => {
    const result = JobSnapshotEventSchema.safeParse({
      ...baseSnapshot,
      progressDetail: { processed: 123954, total: 397960 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an unknown total", () => {
    const result = JobSnapshotEventSchema.safeParse({
      ...baseSnapshot,
      progressDetail: { processed: 123954, total: null },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a snapshot missing progressDetail (required on the snapshot)", () => {
    expect(JobSnapshotEventSchema.safeParse(baseSnapshot).success).toBe(false);
  });
});

describe("JobUpdateEventSchema.progressDetail (#458)", () => {
  const baseUpdate = {
    jobId: "job-1",
    status: "active" as const,
    progress: 40,
    timestamp: 1000,
  };

  it("accepts an update without progressDetail (custom events omit it)", () => {
    expect(JobUpdateEventSchema.safeParse(baseUpdate).success).toBe(true);
  });

  it("accepts an update with progressDetail", () => {
    const result = JobUpdateEventSchema.safeParse({
      ...baseUpdate,
      progressDetail: { processed: 50, total: 200 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed progressDetail", () => {
    const result = JobUpdateEventSchema.safeParse({
      ...baseUpdate,
      progressDetail: { processed: -1, total: null },
    });
    expect(result.success).toBe(false);
  });
});
