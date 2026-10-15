import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindViews = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockFindProjection =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      curatedViews: { findMany: mockFindViews },
      curatedViewFieldMappings: { findMany: mockFindProjection },
    },
  },
}));

const { CuratedViewDependencyService } =
  await import("../../services/curated-view-dependency.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMAIL = {
  id: "fm-email",
  connectorEntityId: "ce-1",
  normalizedKey: "email",
};

function view(
  id: string,
  connectorEntityId: string,
  filter: unknown = null
): Record<string, unknown> {
  return {
    id,
    label: `View ${id}`,
    createdBy: "u-1",
    connectorEntityId,
    filter,
  };
}

/** A transaction stand-in: the lock is the only SQL the service runs itself. */
const mockExecute = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const fakeTx = { execute: mockExecute } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([]);
  mockFindViews.mockResolvedValue([]);
  mockFindProjection.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// findViewsUsingMappings
// ---------------------------------------------------------------------------

describe("CuratedViewDependencyService.findViewsUsingMappings", () => {
  it("finds a view that projects the mapping", async () => {
    mockFindViews.mockResolvedValue([view("cv-1", "ce-1")]);
    mockFindProjection.mockResolvedValue([
      { curatedViewId: "cv-1", fieldMappingId: "fm-email" },
    ]);

    const hits = await CuratedViewDependencyService.findViewsUsingMappings(
      "org-1",
      [EMAIL]
    );

    expect(hits).toEqual([
      { id: "cv-1", label: "View cv-1", createdBy: "u-1" },
    ]);
  });

  it("finds a view whose nested filter names the mapping's key", async () => {
    mockFindViews.mockResolvedValue([
      view("cv-2", "ce-1", {
        combinator: "and",
        conditions: [
          { field: "status", operator: "eq", value: "open" },
          {
            combinator: "or",
            conditions: [{ field: "email", operator: "eq", value: "a@x.com" }],
          },
        ],
      }),
    ]);

    const hits = await CuratedViewDependencyService.findViewsUsingMappings(
      "org-1",
      [EMAIL]
    );

    expect(hits.map((h) => h.id)).toEqual(["cv-2"]);
  });

  it("ignores a view over another entity that filters on the same key", async () => {
    mockFindViews.mockResolvedValue([
      view("cv-3", "ce-other", {
        combinator: "and",
        conditions: [{ field: "email", operator: "eq", value: "a@x.com" }],
      }),
    ]);

    const hits = await CuratedViewDependencyService.findViewsUsingMappings(
      "org-1",
      [EMAIL]
    );

    expect(hits).toEqual([]);
  });

  it("does no lookups for an empty list", async () => {
    expect(
      await CuratedViewDependencyService.findViewsUsingMappings("org-1", [])
    ).toEqual([]);
    expect(mockFindViews).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assertMappingsNotInViews
// ---------------------------------------------------------------------------

describe("CuratedViewDependencyService.assertMappingsNotInViews", () => {
  it("throws 409 FIELD_MAPPING_DELETE_IN_VIEW, naming no view", async () => {
    mockFindViews.mockResolvedValue([view("cv-1", "ce-1")]);
    mockFindProjection.mockResolvedValue([
      { curatedViewId: "cv-1", fieldMappingId: "fm-email" },
    ]);

    const err = await CuratedViewDependencyService.assertMappingsNotInViews(
      "org-1",
      [EMAIL],
      'field mapping "Email"',
      fakeTx
    ).then(
      () => ({}) as Record<string, unknown>,
      (e: unknown) => e as Record<string, unknown>
    );

    expect(err).toMatchObject({
      status: 409,
      code: ApiCode.FIELD_MAPPING_DELETE_IN_VIEW,
      details: { curatedViewCount: 1 },
    });
    expect(String(err.message)).toContain('"Email"');
    expect(String(err.message)).not.toContain("View cv-1");
  });

  it("passes when no view uses the mapping", async () => {
    await expect(
      CuratedViewDependencyService.assertMappingsNotInViews(
        "org-1",
        [EMAIL],
        "Email",
        fakeTx
      )
    ).resolves.toBeUndefined();
  });

  it("takes the entity's view-dependency lock before it reads", async () => {
    await CuratedViewDependencyService.assertMappingsNotInViews(
      "org-1",
      [EMAIL],
      "Email",
      fakeTx
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockFindViews.mock.invocationCallOrder[0]
    );
  });
});

// ---------------------------------------------------------------------------
// assertKeyRenameKeepsViews
// ---------------------------------------------------------------------------

describe("CuratedViewDependencyService.assertKeyRenameKeepsViews", () => {
  const MAPPING = { ...EMAIL, sourceField: "Email" };

  it("refuses with FIELD_MAPPING_KEY_IN_VIEW when a view filters on the old key", async () => {
    mockFindViews.mockResolvedValue([
      view("cv-1", "ce-1", {
        combinator: "and",
        conditions: [{ field: "email", operator: "eq", value: "a@x.com" }],
      }),
    ]);

    await expect(
      CuratedViewDependencyService.assertKeyRenameKeepsViews(
        "org-1",
        MAPPING,
        "contact_email",
        fakeTx
      )
    ).rejects.toMatchObject({
      status: 409,
      code: ApiCode.FIELD_MAPPING_KEY_IN_VIEW,
    });
  });

  it("allows it when a view only projects the mapping (projections link by id)", async () => {
    mockFindViews.mockResolvedValue([view("cv-1", "ce-1")]);
    mockFindProjection.mockResolvedValue([
      { curatedViewId: "cv-1", fieldMappingId: "fm-email" },
    ]);

    await expect(
      CuratedViewDependencyService.assertKeyRenameKeepsViews(
        "org-1",
        MAPPING,
        "contact_email",
        fakeTx
      )
    ).resolves.toBeUndefined();
    expect(mockFindProjection).not.toHaveBeenCalled();
  });

  it("does nothing when the key isn't changing", async () => {
    await CuratedViewDependencyService.assertKeyRenameKeepsViews(
      "org-1",
      MAPPING,
      "email",
      fakeTx
    );
    await CuratedViewDependencyService.assertKeyRenameKeepsViews(
      "org-1",
      MAPPING,
      undefined,
      fakeTx
    );

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockFindViews).not.toHaveBeenCalled();
  });
});
