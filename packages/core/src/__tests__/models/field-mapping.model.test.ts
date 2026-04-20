import {
  FieldMappingModel,
  FieldMappingModelFactory,
  FieldMappingSchema,
} from "../../models/field-mapping.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── FieldMappingSchema ────────────────────────────────────────────────

describe("FieldMappingSchema", () => {
  const base = {
    id: "fm-1",
    organizationId: "org-1",
    connectorEntityId: "ce-1",
    columnDefinitionId: "cd-1",
    sourceField: "my_field",
    isPrimaryKey: false,
    normalizedKey: "my_field",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    refNormalizedKey: null,
    refEntityKey: null,
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };

  it("accepts refNormalizedKey: null and refEntityKey: null", () => {
    const result = FieldMappingSchema.safeParse({
      ...base,
      refNormalizedKey: null,
      refEntityKey: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts refNormalizedKey as a valid string with refEntityKey", () => {
    const result = FieldMappingSchema.safeParse({
      ...base,
      refNormalizedKey: "user_id",
      refEntityKey: "user",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.refNormalizedKey).toBe("user_id");
      expect(result.data.refEntityKey).toBe("user");
    }
  });

  it("rejects refNormalizedKey as a non-string value", () => {
    const result = FieldMappingSchema.safeParse({
      ...base,
      refNormalizedKey: 42,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid snake_case normalizedKey", () => {
    const result = FieldMappingSchema.safeParse({
      ...base,
      normalizedKey: "account_name",
    });
    expect(result.success).toBe(true);
  });

  it("rejects normalizedKey with uppercase characters", () => {
    const result = FieldMappingSchema.safeParse({
      ...base,
      normalizedKey: "Account_Name",
    });
    expect(result.success).toBe(false);
  });

  it("rejects normalizedKey with hyphens", () => {
    const result = FieldMappingSchema.safeParse({
      ...base,
      normalizedKey: "account-name",
    });
    expect(result.success).toBe(false);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

const validMappingFields = {
  organizationId: "org-1",
  connectorEntityId: "ent-1",
  columnDefinitionId: "col-1",
  sourceField: "full_name",
  isPrimaryKey: false,
  normalizedKey: "account_name",
  required: false,
  defaultValue: null,
  format: null,
  enumValues: null,
  refNormalizedKey: null,
  refEntityKey: null,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("FieldMappingModelFactory", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new FieldMappingModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(FieldMappingModelFactory);
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    let factory: FieldMappingModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new FieldMappingModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a FieldMappingModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(FieldMappingModel);
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
      const defaultFactory = new FieldMappingModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new FieldMappingModelFactory({
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

    it("should expose the FieldMappingSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("connectorEntityId");
      expect(shape).toHaveProperty("columnDefinitionId");
      expect(shape).toHaveProperty("sourceField");
      expect(shape).toHaveProperty("isPrimaryKey");
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validMappingFields);

      const json = model.toJSON();
      expect(json.connectorEntityId).toBe("ent-1");
      expect(json.columnDefinitionId).toBe("col-1");
      expect(json.sourceField).toBe("full_name");
      expect(json.isPrimaryKey).toBe(false);
      // base fields preserved
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update(validMappingFields);

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should pass validation with isPrimaryKey set to true", () => {
      const model = factory.create("system");
      model.update({
        ...validMappingFields,
        isPrimaryKey: true,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isPrimaryKey).toBe(true);
      }
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
        expect(paths).toContain("connectorEntityId");
        expect(paths).toContain("columnDefinitionId");
        expect(paths).toContain("sourceField");
        expect(paths).toContain("isPrimaryKey");
      }
    });

    it("should fail validation when isPrimaryKey is not a boolean", () => {
      const model = factory.create("system");
      model.update({
        ...validMappingFields,
        isPrimaryKey: "yes" as never,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(
          (i: { path: unknown[] }) => i.path[0]
        );
        expect(paths).toContain("isPrimaryKey");
      }
    });
  });
});
