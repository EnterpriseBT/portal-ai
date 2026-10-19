import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// #641: a job's actor is a real principal, never a phantom "SYSTEM". The
// metadata's userId wins; a job enqueued without one falls back to the job
// row's createdBy (the caller who started it).

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: { repository: { jobs: { findById: mockFindById } } },
}));

const { UnrecoverableError } = await import("bullmq");
const { resolveJobActor } =
  await import("../../../queues/processors/job-actor.util.js");

describe("resolveJobActor (#641)", () => {
  beforeEach(() => {
    mockFindById.mockReset();
  });

  it("returns the metadata's userId without reading the job row", async () => {
    await expect(resolveJobActor("job-1", "user-1")).resolves.toBe("user-1");
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("falls back to the job row's createdBy when the metadata has no userId", async () => {
    mockFindById.mockResolvedValue({ id: "job-1", createdBy: "user-9" });
    await expect(resolveJobActor("job-1", undefined)).resolves.toBe("user-9");
    expect(mockFindById).toHaveBeenCalledWith("job-1");
  });

  it("throws UnrecoverableError when the job row is gone", async () => {
    mockFindById.mockResolvedValue(undefined);
    const attempt = resolveJobActor("job-1", undefined);
    await expect(attempt).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(resolveJobActor("job-1", undefined)).rejects.toThrow(/job-1/);
  });
});
