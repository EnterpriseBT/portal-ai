/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindColDef = jest.fn<any>().mockResolvedValue({
  id: "cd-1",
  organizationId: "org-1",
  label: "Column 1",
});
const mockCreateMapping = jest.fn<any>().mockResolvedValue({ id: "fm-1" });
const mockFindByEntityAndKey = jest.fn<any>().mockResolvedValue(undefined);
const mockTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      columnDefinitions: { findById: mockFindColDef },
      // #825: the tool only ever inserts; an existing key is refused.
      fieldMappings: {
        create: mockCreateMapping,
        findByEntityAndNormalizedKey: mockFindByEntityAndKey,
      },
    },
  },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

// Stub the reconciler-service module — the tool calls
// `reconcileEntity` after the transaction so wide-table columns
// materialize. Tests don't need the real reconciler; importing it
// pulls in the WideTableColumnsRepository which extends the mocked
// Repository class and breaks at module-load.
const mockReconcileEntity = jest.fn<any>().mockResolvedValue(undefined);
jest.unstable_mockModule(
  "../../services/wide-table-reconciler.service.js",
  () => ({
    wideTableReconcilerService: {
      reconcileEntity: mockReconcileEntity,
      ensureTable: jest.fn<any>().mockResolvedValue(undefined),
    },
  })
);

const { FieldMappingCreateTool } =
  await import("../../tools/field-mapping-create.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type Item = {
  connectorEntityId: string;
  columnDefinitionId: string;
  sourceField: string;
  normalizedKey: string;
  isPrimaryKey?: boolean;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
};
const exec = (input: { items: Item[] }, portalId: string | null = null) =>
  new FieldMappingCreateTool().build("station-1", "org-1", "user-1", portalId)
    .execute!(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });

describe("FieldMappingCreateTool", () => {
  it("single-item regression — upserts one mapping", async () => {
    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "Name",
          normalizedKey: "name",
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockCreateMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorEntityId: "ce-1",
        columnDefinitionId: "cd-1",
        sourceField: "Name",
        normalizedKey: "name",
      }),
      "mock-tx"
    );
  });

  // #641: the portal session that ran the tool is recorded as provenance;
  // the prompting user still owns the mapping.
  it("records the portal session as provenance, owned by the caller (#641)", async () => {
    await exec(
      {
        items: [
          {
            connectorEntityId: "ce-1",
            columnDefinitionId: "cd-1",
            sourceField: "Name",
            normalizedKey: "name",
          },
        ],
      },
      "portal-1"
    );
    expect(mockCreateMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: "user-1",
        sourcePortalId: "portal-1",
      }),
      "mock-tx"
    );
  });

  it("bulk create — 3 mappings upserted in transaction", async () => {
    mockFindColDef
      .mockResolvedValueOnce({
        id: "cd-1",
        organizationId: "org-1",
        label: "C1",
      })
      .mockResolvedValueOnce({
        id: "cd-2",
        organizationId: "org-1",
        label: "C2",
      });
    mockCreateMapping
      .mockResolvedValueOnce({ id: "fm-1" })
      .mockResolvedValueOnce({ id: "fm-2" })
      .mockResolvedValueOnce({ id: "fm-3" });

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "B",
          normalizedKey: "b",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-2",
          sourceField: "C",
          normalizedKey: "c",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockCreateMapping).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  // #825: an agent "create" on an existing (entity, normalizedKey) used to
  // upsert, rewriting another user's mapping (source field, column definition,
  // primary key) under a create-only permission check.
  it("refuses an existing mapping key, pointing at the update tool, and writes nothing", async () => {
    mockFindByEntityAndKey.mockResolvedValueOnce({ id: "fm-existing" });
    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "Name",
          normalizedKey: "name",
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.failures[0].error).toMatch(/already exists/i);
    expect(result.failures[0].error).toContain("field_mapping_update");
    expect(mockFindByEntityAndKey).toHaveBeenCalledWith("ce-1", "name");
    expect(mockCreateMapping).not.toHaveBeenCalled();
  });

  it("reports a mapping key taken concurrently as already existing, not as created", async () => {
    mockCreateMapping.mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value"), { code: "23505" })
    );
    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "Name",
          normalizedKey: "name",
        },
      ],
    });
    expect(result.success).not.toBe(true);
    expect(JSON.stringify(result)).toMatch(/already exists/i);
  });

  it("validation failure — column definition not found for one item", async () => {
    mockFindColDef
      .mockResolvedValueOnce({
        id: "cd-1",
        organizationId: "org-1",
        label: "C1",
      })
      .mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-missing",
          sourceField: "B",
          normalizedKey: "b",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockCreateMapping).not.toHaveBeenCalled();
  });

  it("validation failure — column definition belongs to different org", async () => {
    mockFindColDef.mockResolvedValueOnce({
      id: "cd-1",
      organizationId: "other-org",
      label: "C1",
    });

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(mockCreateMapping).not.toHaveBeenCalled();
  });

  it("batch column definition lookup — deduplicates findById calls", async () => {
    mockFindColDef.mockResolvedValue({
      id: "cd-1",
      organizationId: "org-1",
      label: "C1",
    });
    mockCreateMapping.mockResolvedValue({ id: "fm-1" });

    await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "B",
          normalizedKey: "b",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "C",
          normalizedKey: "c",
        },
      ],
    });

    // Should look up cd-1 only once, not 3 times
    expect(mockFindColDef).toHaveBeenCalledTimes(1);
  });

  it("scope check failure blocks all items", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope violation"));

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "B",
          normalizedKey: "b",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toHaveLength(2);
    expect(mockCreateMapping).not.toHaveBeenCalled();
  });
});

// #801: a normalizedKey becomes the `c_<key>` column, so it is capped like the
// request contract's.
describe("FieldMappingCreateTool input limits", () => {
  const schema = () => new FieldMappingCreateTool().schema;
  const keyIssues = (normalizedKey: string) => {
    const result = schema().safeParse({ items: [{ normalizedKey }] });
    return (result.error?.issues ?? []).filter((i) =>
      i.path.includes("normalizedKey")
    );
  };

  it("accepts a 58-character key", () => {
    expect(keyIssues("k".repeat(58))).toEqual([]);
  });

  it("rejects a 59-character key", () => {
    expect(keyIssues("k".repeat(59)).map((i) => i.message)).toContain(
      "Normalized key must be 58 characters or fewer"
    );
  });
});
