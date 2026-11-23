import {
  EntityTagAssignmentModelFactory,
  EntityTagAssignmentSchema,
  TAG_TARGET_COLUMNS,
} from "../../models/entity-tag-assignment.model.js";
import { TagTargetTypeSchema } from "../../models/tag-target.model.js";
import { PERMISSION_RESOURCE_TYPES } from "../../models/permission.model.js";

const base = {
  id: "eta-1",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  organizationId: "org-1",
  entityTagId: "tag-1",
};

const noTargets = {
  connectorEntityId: null,
  stationId: null,
  portalResultId: null,
  connectorInstanceId: null,
  curatedViewId: null,
};

describe("EntityTagAssignmentSchema (#1070)", () => {
  it.each(Object.values(TAG_TARGET_COLUMNS))(
    "accepts a row whose only target is %s",
    (column) => {
      const result = EntityTagAssignmentSchema.safeParse({
        ...base,
        ...noTargets,
        [column]: "target-1",
      });
      expect(result.success).toBe(true);
    }
  );

  it("rejects a row with no target", () => {
    expect(
      EntityTagAssignmentSchema.safeParse({ ...base, ...noTargets }).success
    ).toBe(false);
  });

  it("rejects a row with two targets", () => {
    const result = EntityTagAssignmentSchema.safeParse({
      ...base,
      ...noTargets,
      connectorEntityId: "ce-1",
      stationId: "st-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("tag targets (#1070)", () => {
  it("maps every target type to a column and a permission resource type", () => {
    for (const type of TagTargetTypeSchema.options) {
      expect(TAG_TARGET_COLUMNS[type]).toBeDefined();
      // Each target type is checked as the permission type of its own name.
      expect(PERMISSION_RESOURCE_TYPES).toContain(type);
    }
  });
});

describe("EntityTagAssignmentModelFactory (#1070)", () => {
  it("starts every target null so setting one parses", () => {
    const model = new EntityTagAssignmentModelFactory().create("user-1");
    model.update({
      organizationId: "org-1",
      stationId: "st-1",
      entityTagId: "tag-1",
    });
    const row = model.parse();
    expect(row.stationId).toBe("st-1");
    expect(row.connectorEntityId).toBeNull();
  });
});
