import {
  EntityGroupMemberModel,
  EntityGroupMemberModelFactory,
  EntityGroupMemberSchema,
} from "../../models/entity-group-member.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validMemberFields = {
  organizationId: "org-1",
  entityGroupId: "eg-1",
  connectorEntityId: "ce-1",
  linkFieldMappingId: "fm-1",
  isPrimary: false,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("EntityGroupMemberSchema", () => {
  it("should accept valid data with all fields", () => {
    const data = {
      id: "egm-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      entityGroupId: "eg-1",
      connectorEntityId: "ce-1",
      linkFieldMappingId: "fm-1",
      isPrimary: false,
    };
    const result = EntityGroupMemberSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should default isPrimary to false", () => {
    const data = {
      id: "egm-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      entityGroupId: "eg-1",
      connectorEntityId: "ce-1",
      linkFieldMappingId: "fm-1",
    };
    const result = EntityGroupMemberSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isPrimary).toBe(false);
    }
  });

  it("should accept isPrimary: true", () => {
    const data = {
      id: "egm-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      entityGroupId: "eg-1",
      connectorEntityId: "ce-1",
      linkFieldMappingId: "fm-1",
      isPrimary: true,
    };
    const result = EntityGroupMemberSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isPrimary).toBe(true);
    }
  });
});

describe("EntityGroupMemberModelFactory", () => {
  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new EntityGroupMemberModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(EntityGroupMemberModelFactory);
    });
  });

  describe("create", () => {
    let factory: EntityGroupMemberModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new EntityGroupMemberModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return an EntityGroupMemberModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(EntityGroupMemberModel);
    });

    it("should assign the generated id from the underlying CoreModelFactory", () => {
      const model = factory.create("user-1");
      expect(model.toJSON().id).toBe("test-id-1");
    });

    it("should set the createdBy field to the provided value", () => {
      const model = factory.create("admin-42");
      expect(model.toJSON().createdBy).toBe("admin-42");
    });

    it("should set a created timestamp", () => {
      const before = Date.now();
      const model = factory.create("user-1");
      const after = Date.now();
      const created = model.toJSON().created;

      expect(created).toBeDefined();
      expect(created).toBeGreaterThanOrEqual(before);
      expect(created).toBeLessThanOrEqual(after);
    });

    it("should not set updated, updatedBy, deleted, or deletedBy", () => {
      const json = factory.create("user-1").toJSON();

      expect(json.updated).toBeNull();
      expect(json.updatedBy).toBeNull();
      expect(json.deleted).toBeNull();
      expect(json.deletedBy).toBeNull();
    });

    it("should produce unique ids across multiple calls", () => {
      const defaultFactory = new EntityGroupMemberModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new EntityGroupMemberModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const model = defaultFactory.create("user-1");
      expect(model.toJSON().id).toMatch(UUID_REGEX);
    });

    it("should return a different instance on each call", () => {
      const a = factory.create("user-a");
      const b = factory.create("user-b");

      expect(a).not.toBe(b);
      expect(a.toJSON().id).not.toBe(b.toJSON().id);
    });

    it("should expose the EntityGroupMemberSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("organizationId");
      expect(shape).toHaveProperty("entityGroupId");
      expect(shape).toHaveProperty("connectorEntityId");
      expect(shape).toHaveProperty("linkFieldMappingId");
      expect(shape).toHaveProperty("isPrimary");
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validMemberFields);

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.entityGroupId).toBe("eg-1");
      expect(json.connectorEntityId).toBe("ce-1");
      expect(json.linkFieldMappingId).toBe("fm-1");
      expect(json.isPrimary).toBe(false);
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update(validMemberFields);

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation when domain-specific required fields are missing", () => {
      const model = factory.create("user-1");
      model.update({
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(
          (i: { path: unknown[] }) => i.path[0]
        );
        expect(paths).toContain("organizationId");
        expect(paths).toContain("entityGroupId");
        expect(paths).toContain("connectorEntityId");
        expect(paths).toContain("linkFieldMappingId");
      }
    });
  });
});
