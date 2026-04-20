import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockJobsFindMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockFieldMappingsFindByColumnDefinitionId =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockJobsServiceCreate =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      jobs: { findMany: mockJobsFindMany },
      fieldMappings: {
        findByColumnDefinitionId: mockFieldMappingsFindByColumnDefinitionId,
      },
    },
  },
}));

jest.unstable_mockModule("../../services/jobs.service.js", () => ({
  JobsService: { create: mockJobsServiceCreate },
}));

jest.unstable_mockModule("../../db/schema/index.js", () => ({
  jobs: { type: "type", status: "status" },
}));

const { RevalidationService } =
  await import("../../services/revalidation.service.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function activeJob(
  connectorEntityId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "job-active-1",
    type: "revalidation",
    status: "active",
    metadata: { connectorEntityId, organizationId: "org-1" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — findActiveJob
// ---------------------------------------------------------------------------

describe("RevalidationService.findActiveJob", () => {
  it("returns null when no active jobs exist", async () => {
    mockJobsFindMany.mockResolvedValue([]);

    const result = await RevalidationService.findActiveJob("ce-1");

    expect(result).toBeNull();
  });

  it("returns the job when a pending revalidation job exists for the entity", async () => {
    const job = activeJob("ce-1", { status: "pending" });
    mockJobsFindMany.mockResolvedValue([job]);

    const result = await RevalidationService.findActiveJob("ce-1");

    expect(result).toEqual(job);
  });

  it("returns the job when an active revalidation job exists for the entity", async () => {
    const job = activeJob("ce-1", { status: "active" });
    mockJobsFindMany.mockResolvedValue([job]);

    const result = await RevalidationService.findActiveJob("ce-1");

    expect(result).toEqual(job);
  });

  it("returns null when active jobs belong to a different entity", async () => {
    mockJobsFindMany.mockResolvedValue([activeJob("ce-other")]);

    const result = await RevalidationService.findActiveJob("ce-1");

    expect(result).toBeNull();
  });

  it("returns null when only completed/failed/cancelled jobs exist", async () => {
    // These statuses won't be returned by the findMany query (filtered by ACTIVE_STATUSES),
    // so the mock returns an empty array to simulate that.
    mockJobsFindMany.mockResolvedValue([]);

    const result = await RevalidationService.findActiveJob("ce-1");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — assertNoActiveJob
// ---------------------------------------------------------------------------

describe("RevalidationService.assertNoActiveJob", () => {
  it("resolves when no active job exists", async () => {
    mockJobsFindMany.mockResolvedValue([]);

    await expect(
      RevalidationService.assertNoActiveJob("ce-1")
    ).resolves.toBeUndefined();
  });

  it("throws 409 REVALIDATION_ACTIVE when active job exists", async () => {
    mockJobsFindMany.mockResolvedValue([activeJob("ce-1")]);

    await expect(
      RevalidationService.assertNoActiveJob("ce-1")
    ).rejects.toMatchObject({
      status: 409,
      code: "REVALIDATION_ACTIVE",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — assertNoActiveJobForColumnDefinition
// ---------------------------------------------------------------------------

describe("RevalidationService.assertNoActiveJobForColumnDefinition", () => {
  it("resolves when no entities use the column definition", async () => {
    mockFieldMappingsFindByColumnDefinitionId.mockResolvedValue([]);

    await expect(
      RevalidationService.assertNoActiveJobForColumnDefinition("cd-1")
    ).resolves.toBeUndefined();
  });

  it("resolves when entities exist but no active revalidation jobs", async () => {
    mockFieldMappingsFindByColumnDefinitionId.mockResolvedValue([
      { connectorEntityId: "ce-1" },
      { connectorEntityId: "ce-2" },
    ]);
    mockJobsFindMany.mockResolvedValue([]);

    await expect(
      RevalidationService.assertNoActiveJobForColumnDefinition("cd-1")
    ).resolves.toBeUndefined();
  });

  it("throws when an entity using the column def has an active revalidation job", async () => {
    mockFieldMappingsFindByColumnDefinitionId.mockResolvedValue([
      { connectorEntityId: "ce-1" },
    ]);
    mockJobsFindMany.mockResolvedValue([activeJob("ce-1")]);

    await expect(
      RevalidationService.assertNoActiveJobForColumnDefinition("cd-1")
    ).rejects.toMatchObject({
      status: 409,
      code: "REVALIDATION_ACTIVE",
    });
  });

  it("deduplicates entity IDs when multiple mappings point to the same entity", async () => {
    mockFieldMappingsFindByColumnDefinitionId.mockResolvedValue([
      { connectorEntityId: "ce-1" },
      { connectorEntityId: "ce-1" },
    ]);
    mockJobsFindMany.mockResolvedValue([]);

    await RevalidationService.assertNoActiveJobForColumnDefinition("cd-1");

    // findMany should only be called once for the deduplicated entity
    expect(mockJobsFindMany).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — enqueue
// ---------------------------------------------------------------------------

describe("RevalidationService.enqueue", () => {
  it("creates a new job when none is active", async () => {
    mockJobsFindMany.mockResolvedValue([]);
    const newJob = { id: "job-new", type: "revalidation", status: "pending" };
    mockJobsServiceCreate.mockResolvedValue(newJob);

    const result = await RevalidationService.enqueue("ce-1", "org-1", "user-1");

    expect(result).toEqual(newJob);
    expect(mockJobsServiceCreate).toHaveBeenCalledWith("user-1", {
      type: "revalidation",
      organizationId: "org-1",
      metadata: { connectorEntityId: "ce-1", organizationId: "org-1" },
    });
  });

  it("returns existing job when one is already active (idempotent)", async () => {
    const existing = activeJob("ce-1");
    mockJobsFindMany.mockResolvedValue([existing]);

    const result = await RevalidationService.enqueue("ce-1", "org-1", "user-1");

    expect(result).toEqual(existing);
    expect(mockJobsServiceCreate).not.toHaveBeenCalled();
  });
});
