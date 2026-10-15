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

beforeEach(() => {
  jest.clearAllMocks();
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
      "Email"
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
        "Email"
      )
    ).resolves.toBeUndefined();
  });
});
