import { describe, it, expect } from "@jest/globals";
import type { z } from "zod";

import * as contracts from "../../contracts/index.js";

/**
 * #801: each request contract that carries user-authored text enforces the
 * shared limits at their boundary. `name-length.guard.test.ts` proves every
 * guarded field has *a* max; this pins that the max is the shared one, with
 * its message, on a representative body per schema family.
 */

const N = (n: number) => "a".repeat(n);
const K = (n: number) => "k".repeat(n);

const plan = (targetEntityDefinitionId: string, normalizedKey?: string) => ({
  planVersion: "1.0.0",
  workbookFingerprint: {
    sheetNames: ["Contacts"],
    dimensions: { Contacts: { rows: 4, cols: 1 } },
    anchorCells: [{ sheet: "Contacts", row: 1, col: 1, value: "name" }],
  },
  regions: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      sheet: "Contacts",
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 1 },
      targetEntityDefinitionId,
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 1 }] },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Contacts", row: 1 },
          confidence: 0.95,
        },
      },
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "column", sheet: "Contacts", col: 1 },
        confidence: 0.9,
      },
      columnBindings: [
        {
          sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
          columnDefinitionId: "col-name",
          confidence: 0.92,
          ...(normalizedKey === undefined ? {} : { normalizedKey }),
        },
      ],
      skipRules: [{ kind: "blank" }],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 0, action: "halt" },
      },
      confidence: { region: 0.9, aggregate: 0.87 },
      warnings: [],
    },
  ],
  confidence: {
    overall: 0.9,
    perRegion: { "11111111-1111-4111-8111-111111111111": 0.9 },
  },
});

const statement = {
  effect: "allow",
  verb: "read",
  resourceType: "station",
  resourceId: null,
  condition: null,
};

interface Case {
  schema: keyof typeof contracts;
  base: Record<string, unknown>;
  field: string;
  /** The longest accepted value. */
  ok: string;
  /** One character too many. */
  long: string;
  message: string;
}

const NAME = "Name must be 120 characters or fewer";
const LABEL = "Label must be 120 characters or fewer";
const DESCRIPTION = "Description must be 2000 characters or fewer";

const CASES: Case[] = [
  {
    schema: "CreateStationBodySchema",
    base: { name: "S", toolPacks: ["data_query"] },
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "UpdateStationBodySchema",
    base: {},
    field: "description",
    ok: N(2000),
    long: N(2001),
    message: DESCRIPTION,
  },
  {
    schema: "UpdatePortalBodySchema",
    base: {},
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "UpdatePortalResultBodySchema",
    base: {},
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "PinResultBodySchema",
    base: { portalId: "p", blockIndex: 0, name: "P" },
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "EntityTagCreateRequestBodySchema",
    base: { name: "T" },
    field: "description",
    ok: N(2000),
    long: N(2001),
    message: DESCRIPTION,
  },
  {
    schema: "EntityGroupCreateRequestBodySchema",
    base: { name: "G" },
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "ColumnDefinitionCreateRequestBodySchema",
    base: { key: "k", label: "L", type: "string" },
    field: "key",
    ok: K(58),
    long: K(59),
    message: "Key must be 58 characters or fewer",
  },
  {
    schema: "ColumnDefinitionUpdateRequestBodySchema",
    base: {},
    field: "validationMessage",
    ok: N(2000),
    long: N(2001),
    message: "Validation message must be 2000 characters or fewer",
  },
  {
    schema: "ConnectorEntityCreateRequestBodySchema",
    base: { connectorInstanceId: "ci", key: "k", label: "L" },
    field: "label",
    ok: N(120),
    long: N(121),
    message: LABEL,
  },
  {
    schema: "ConnectorInstancePatchRequestBodySchema",
    base: { name: "C" },
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "PatchApiEndpointRequestBodySchema",
    base: {},
    field: "label",
    ok: N(120),
    long: N(121),
    message: LABEL,
  },
  {
    schema: "PolicyUpsertRequestSchema",
    base: { name: "P", statements: [statement] },
    field: "description",
    ok: N(2000),
    long: N(2001),
    message: DESCRIPTION,
  },
  {
    schema: "RoleUpsertRequestSchema",
    base: { name: "R", policyIds: [] },
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "GroupUpsertRequestSchema",
    base: { name: "G", policyIds: [] },
    field: "name",
    ok: N(120),
    long: N(121),
    message: NAME,
  },
  {
    schema: "CuratedViewUpdateRequestBodySchema",
    base: {},
    field: "label",
    ok: N(120),
    long: N(121),
    message: LABEL,
  },
  {
    schema: "FieldMappingUpdateRequestBodySchema",
    base: { sourceField: "Name", columnDefinitionId: "cd" },
    field: "normalizedKey",
    ok: K(58),
    long: K(59),
    message: "Normalized key must be 58 characters or fewer",
  },
  {
    schema: "UpdateToolpackBodySchema",
    base: {},
    field: "description",
    ok: N(2000),
    long: N(2001),
    message: DESCRIPTION,
  },
];

const parse = (name: keyof typeof contracts, body: unknown) =>
  (contracts[name] as unknown as z.ZodType).safeParse(body);

describe("request contracts adopt the text limits (#801)", () => {
  it.each(CASES)("$schema accepts $field at the limit", (c) => {
    const result = parse(c.schema, { ...c.base, [c.field]: c.ok });
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(CASES)("$schema rejects $field past the limit", (c) => {
    const result = parse(c.schema, { ...c.base, [c.field]: c.long });
    expect(result.success).toBe(false);
    expect(result.error!.issues).toEqual([
      expect.objectContaining({ path: [c.field], message: c.message }),
    ]);
  });

  it("names are trimmed, and a whitespace-only name is required", () => {
    const result = parse("CreateStationBodySchema", {
      name: "   ",
      toolPacks: ["data_query"],
    });
    expect(result.error!.issues).toEqual([
      expect.objectContaining({ path: ["name"], message: "Name is required" }),
    ]);
    expect(
      contracts.CreateStationBodySchema.parse({
        name: "  Ops  ",
        toolPacks: ["data_query"],
      }).name
    ).toBe("Ops");
  });

  describe("LayoutPlanCommitDraftRequestBodySchema", () => {
    const body = (p: unknown, name = "Contacts upload") => ({
      connectorDefinitionId: "def",
      name,
      plan: p,
      uploadSessionId: "upload",
    });

    it("accepts a plan within the limits", () => {
      const result = parse(
        "LayoutPlanCommitDraftRequestBodySchema",
        body(plan(K(58), K(58)))
      );
      expect(result.error?.issues ?? []).toEqual([]);
    });

    it("rejects an over-length entity key at its plan path", () => {
      const result = parse(
        "LayoutPlanCommitDraftRequestBodySchema",
        body(plan(K(59)))
      );
      expect(result.error!.issues).toEqual([
        expect.objectContaining({
          path: ["plan", "regions", 0, "targetEntityDefinitionId"],
          message: "Entity key must be 58 characters or fewer",
        }),
      ]);
    });

    it("rejects an over-length binding key at its plan path", () => {
      const result = parse(
        "LayoutPlanCommitDraftRequestBodySchema",
        body(plan("contacts", K(59)))
      );
      expect(result.error!.issues).toEqual([
        expect.objectContaining({
          path: ["plan", "regions", 0, "columnBindings", 0, "normalizedKey"],
          message: "Normalized key must be 58 characters or fewer",
        }),
      ]);
    });

    it("rejects an over-length connector name", () => {
      const result = parse(
        "LayoutPlanCommitDraftRequestBodySchema",
        body(plan("contacts"), N(121))
      );
      expect(result.error!.issues).toEqual([
        expect.objectContaining({ path: ["name"], message: NAME }),
      ]);
    });
  });
});
