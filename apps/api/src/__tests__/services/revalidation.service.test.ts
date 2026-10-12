import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEnqueueExclusive =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

// #769: whether a job conflicts is the lock model's call, covered by
// job-lock.integration.test; here it's the boundary.
jest.unstable_mockModule("../../services/job-lock.service.js", () => ({
  JobLockService: { enqueueExclusive: mockEnqueueExclusive },
}));

const { RevalidationService } =
  await import("../../services/revalidation.service.js");

describe("RevalidationService.enqueue", () => {
  beforeEach(() => {
    mockEnqueueExclusive.mockReset();
  });

  // #769: the lock model decides conflicts; a revalidation already running on
  // the entity comes back through `onSameJob: "reuse"`.
  it("enqueues exclusively, reusing a running revalidation on the entity", async () => {
    const job = { id: "job-new", type: "revalidation", status: "pending" };
    mockEnqueueExclusive.mockResolvedValue(job);

    const result = await RevalidationService.enqueue("ce-1", "org-1", "user-1");

    expect(result).toEqual(job);
    expect(mockEnqueueExclusive).toHaveBeenCalledWith(
      "user-1",
      {
        type: "revalidation",
        organizationId: "org-1",
        metadata: { connectorEntityId: "ce-1", organizationId: "org-1" },
      },
      { onSameJob: "reuse" }
    );
  });

  it("lets a lock refusal through to the caller", async () => {
    mockEnqueueExclusive.mockRejectedValue(
      Object.assign(new Error("Sync is running on this connector."), {
        status: 409,
      })
    );

    await expect(
      RevalidationService.enqueue("ce-1", "org-1", "user-1")
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("RevalidationService.enqueueAfterEdit (#769)", () => {
  beforeEach(() => {
    mockEnqueueExclusive.mockReset();
  });

  it("swallows a refusal: the edit has already committed", async () => {
    mockEnqueueExclusive.mockRejectedValue(new Error("locked"));

    await expect(
      RevalidationService.enqueueAfterEdit("ce-1", "org-1", "user-1")
    ).resolves.toBeUndefined();
  });

  it("enqueues when nothing holds the entity", async () => {
    mockEnqueueExclusive.mockResolvedValue({ id: "j" });

    await RevalidationService.enqueueAfterEdit("ce-1", "org-1", "user-1");

    expect(mockEnqueueExclusive).toHaveBeenCalledTimes(1);
  });
});
