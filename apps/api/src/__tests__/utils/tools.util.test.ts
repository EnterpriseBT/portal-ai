/**
 * Unit tests for `apps/api/src/utils/tools.util.ts` — the helper layer
 * the math tool wrappers use to resolve entity keys to connectorEntityIds
 * and fetch projected rows from the phase-2 wide tables (Phase 3 slice 3).
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFetchProjectedRows = jest.fn<
  (
    connectorEntityId: string,
    columns: ReadonlyArray<string>,
    opts: { organizationId: string; limit?: number }
  ) => Promise<Record<string, unknown>[]>
>();

jest.unstable_mockModule(
  "../../db/repositories/wide-table.repository.js",
  () => ({
    wideTableRepo: { fetchProjectedRows: mockFetchProjectedRows },
    WideTableRepository: class {},
  })
);

const { fetchEntityRows, resolveEntityId } = await import(
  "../../utils/tools.util.js"
);

type StationData = import("../../services/analytics.service.js").StationData;

const STATION_DATA: StationData = {
  entities: [
    {
      id: "ent-contacts",
      key: "contacts",
      label: "Contacts",
      connectorInstanceId: "ci-1",
      columns: [
        {
          key: "email",
          label: "Email",
          type: "string",
          columnDefinitionId: "cd-1",
          fieldMappingId: "fm-1",
          sourceField: "Email",
        },
        {
          key: "age",
          label: "Age",
          type: "number",
          columnDefinitionId: "cd-2",
          fieldMappingId: "fm-2",
          sourceField: "Age",
        },
      ],
    },
    {
      id: "ent-deals",
      key: "deals",
      label: "Deals",
      connectorInstanceId: "ci-1",
      columns: [
        {
          key: "amount",
          label: "Amount",
          type: "number",
          columnDefinitionId: "cd-3",
          fieldMappingId: "fm-3",
          sourceField: "Amount",
        },
      ],
    },
  ],
  entityGroups: [],
  records: new Map(),
};

describe("resolveEntityId", () => {
  it("returns the entity id for a known key", () => {
    expect(resolveEntityId(STATION_DATA, "contacts")).toBe("ent-contacts");
  });

  it("throws for an unknown key", () => {
    expect(() => resolveEntityId(STATION_DATA, "nope")).toThrow(/not found/);
  });
});

describe("fetchEntityRows", () => {
  beforeEach(() => {
    mockFetchProjectedRows.mockReset();
  });

  it("resolves entityKey to connectorEntityId and forwards columns + organizationId", async () => {
    mockFetchProjectedRows.mockResolvedValueOnce([
      { _record_id: "r1", email: "a@b.co", age: 30 },
    ]);

    const rows = await fetchEntityRows(
      STATION_DATA,
      "contacts",
      ["email", "age"],
      "org-1"
    );

    expect(rows).toHaveLength(1);
    expect(mockFetchProjectedRows).toHaveBeenCalledTimes(1);
    const [entityId, cols, opts] = mockFetchProjectedRows.mock.calls[0]!;
    expect(entityId).toBe("ent-contacts");
    expect(cols).toEqual(["email", "age"]);
    expect(opts.organizationId).toBe("org-1");
  });

  it("expands '*' to every known column key on the entity", async () => {
    mockFetchProjectedRows.mockResolvedValueOnce([]);
    await fetchEntityRows(STATION_DATA, "contacts", "*", "org-1");
    const [, cols] = mockFetchProjectedRows.mock.calls[0]!;
    expect(cols).toEqual(["email", "age"]);
  });

  it("throws when the entity key is unknown", async () => {
    await expect(
      fetchEntityRows(STATION_DATA, "missing", ["x"], "org-1")
    ).rejects.toThrow(/not found/);
    expect(mockFetchProjectedRows).not.toHaveBeenCalled();
  });

  it("forwards opts.limit through to fetchProjectedRows", async () => {
    mockFetchProjectedRows.mockResolvedValueOnce([]);
    await fetchEntityRows(STATION_DATA, "contacts", ["age"], "org-1", {
      limit: 100,
    });
    const [, , opts] = mockFetchProjectedRows.mock.calls[0]!;
    expect(opts.limit).toBe(100);
  });
});
