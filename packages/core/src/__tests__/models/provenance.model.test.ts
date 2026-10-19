import { ConnectorEntitySchema } from "../../models/connector-entity.model.js";
import { EntityRecordSchema } from "../../models/entity-record.model.js";
import { FieldMappingSchema } from "../../models/field-mapping.model.js";
import {
  GroupSchema,
  PolicySchema,
  RoleSchema,
} from "../../models/permission.model.js";
import { isSessionGenerated } from "../../models/provenance.model.js";

// #641: provenance records which portal session produced an object. It is
// never ownership; these tests pin the marker's shape and its derivation.

describe("isSessionGenerated (#641)", () => {
  it("is true for a row a portal session produced", () => {
    expect(isSessionGenerated({ sourcePortalId: "portal-1" })).toBe(true);
  });

  it("is false with no portal", () => {
    expect(isSessionGenerated({ sourcePortalId: null })).toBe(false);
    expect(isSessionGenerated({})).toBe(false);
  });

  it("is false for an empty portal id", () => {
    expect(isSessionGenerated({ sourcePortalId: "" })).toBe(false);
  });

  it("is true for a record the agent created before #641 (origin portal)", () => {
    expect(isSessionGenerated({ sourcePortalId: null, origin: "portal" })).toBe(
      true
    );
  });

  it("is false for a synced or manual record", () => {
    expect(isSessionGenerated({ sourcePortalId: null, origin: "sync" })).toBe(
      false
    );
    expect(isSessionGenerated({ origin: "manual" })).toBe(false);
  });
});

const core = {
  id: "id-1",
  created: 1,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const rows = {
  ConnectorEntitySchema: [
    ConnectorEntitySchema,
    {
      ...core,
      organizationId: "org-1",
      connectorInstanceId: "ci-1",
      key: "contacts",
      label: "Contacts",
    },
  ],
  FieldMappingSchema: [
    FieldMappingSchema,
    {
      ...core,
      organizationId: "org-1",
      connectorEntityId: "ce-1",
      columnDefinitionId: "cd-1",
      sourceField: "name",
      isPrimaryKey: false,
      normalizedKey: "name",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
    },
  ],
  EntityRecordSchema: [
    EntityRecordSchema,
    {
      ...core,
      organizationId: "org-1",
      connectorEntityId: "ce-1",
      data: {},
      normalizedData: {},
      sourceId: "s-1",
      checksum: "c",
      syncedAt: 1,
      validationErrors: null,
      isValid: true,
    },
  ],
  PolicySchema: [
    PolicySchema,
    {
      ...core,
      organizationId: "org-1",
      name: "P",
      kind: "custom",
      description: null,
    },
  ],
  RoleSchema: [
    RoleSchema,
    { ...core, organizationId: "org-1", name: "R", slug: "r", kind: "custom" },
  ],
  GroupSchema: [
    GroupSchema,
    { ...core, organizationId: "org-1", name: "G", description: null },
  ],
} as const;

describe("sourcePortalId on the session-producible models (#641)", () => {
  it.each(Object.entries(rows))(
    "%s defaults a missing sourcePortalId to null",
    (_name, [schema, row]) => {
      const parsed = schema.parse(row) as { sourcePortalId: unknown };
      expect(parsed.sourcePortalId).toBeNull();
    }
  );

  it.each(Object.entries(rows))(
    "%s keeps a given sourcePortalId",
    (_name, [schema, row]) => {
      const parsed = schema.parse({ ...row, sourcePortalId: "portal-1" }) as {
        sourcePortalId: unknown;
      };
      expect(parsed.sourcePortalId).toBe("portal-1");
    }
  );
});
