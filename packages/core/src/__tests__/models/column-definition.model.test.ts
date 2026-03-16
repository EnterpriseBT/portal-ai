import {
  ColumnDefinitionModel,
  ColumnDefinitionModelFactory,
  ColumnDefinitionSchema,
  ColumnDataTypeEnum,
} from "../../models/column-definition.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validColumnFields = {
  organizationId: "org-1",
  key: "email",
  label: "Email",
  type: "string" as const,
  required: true,
  defaultValue: null,
  format: "email",
  enumValues: null,
  description: "Primary email address",
  refColumnDefinitionId: null,
  refEntityKey: null,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const validReferenceFields = {
  ...validColumnFields,
  key: "account_owner",
  label: "Account Owner",
  type: "reference" as const,
  refColumnDefinitionId: "col-id-1",
  refEntityKey: "users",
  format: null,
};

// ── ColumnDataType enum ──────────────────────────────────────────────

describe("ColumnDataTypeEnum", () => {
  it.each([
    "string",
    "number",
    "boolean",
    "date",
    "datetime",
    "enum",
    "json",
    "array",
    "reference",
    "currency",
  ])("should accept '%s' as a valid type", (type) => {
    const result = ColumnDataTypeEnum.safeParse(type);
    expect(result.success).toBe(true);
  });

  it("should reject unknown types", () => {
    const result = ColumnDataTypeEnum.safeParse("bigint");
    expect(result.success).toBe(false);
  });
});

// ── ColumnDefinitionSchema (key regex) ───────────────────────────────

describe("ColumnDefinitionSchema key validation", () => {
  const parse = (key: string) =>
    ColumnDefinitionSchema.shape.key.safeParse(key);

  it.each(["name", "first_name", "a1", "account_owner_id"])(
    "should accept valid key '%s'",
    (key) => {
      expect(parse(key).success).toBe(true);
    }
  );

  it.each(["Name", "1name", "first-name", "has space", "", "_leading"])(
    "should reject invalid key '%s'",
    (key) => {
      expect(parse(key).success).toBe(false);
    }
  );
});

// ── ColumnDefinitionModelFactory ─────────────────────────────────────

describe("ColumnDefinitionModelFactory", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new ColumnDefinitionModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(ColumnDefinitionModelFactory);
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    let factory: ColumnDefinitionModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new ColumnDefinitionModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a ColumnDefinitionModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(ColumnDefinitionModel);
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
      const defaultFactory = new ColumnDefinitionModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new ColumnDefinitionModelFactory({
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

    it("should expose the ColumnDefinitionSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("organizationId");
      expect(shape).toHaveProperty("key");
      expect(shape).toHaveProperty("label");
      expect(shape).toHaveProperty("type");
      expect(shape).toHaveProperty("required");
      expect(shape).toHaveProperty("defaultValue");
      expect(shape).toHaveProperty("format");
      expect(shape).toHaveProperty("enumValues");
      expect(shape).toHaveProperty("description");
      expect(shape).toHaveProperty("refColumnDefinitionId");
      expect(shape).toHaveProperty("refEntityKey");
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validColumnFields);

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.key).toBe("email");
      expect(json.label).toBe("Email");
      expect(json.type).toBe("string");
      expect(json.required).toBe(true);
      expect(json.format).toBe("email");
      expect(json.enumValues).toBeNull();
      expect(json.description).toBe("Primary email address");
      expect(json.refColumnDefinitionId).toBeNull();
      expect(json.refEntityKey).toBeNull();
      // base fields preserved
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update(validColumnFields);

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should pass validation for a reference column with ref fields set", () => {
      const model = factory.create("system");
      model.update(validReferenceFields);

      const result = model.validate();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("reference");
        expect(result.data.refColumnDefinitionId).toBe("col-id-1");
        expect(result.data.refEntityKey).toBe("users");
      }
    });

    it("should pass validation for an enum column with enumValues set", () => {
      const model = factory.create("system");
      model.update({
        ...validColumnFields,
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["active", "inactive", "archived"],
      });

      const result = model.validate();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enumValues).toEqual(["active", "inactive", "archived"]);
      }
    });

    it("should pass validation when nullable fields are null", () => {
      const model = factory.create("system");
      model.update({
        ...validColumnFields,
        format: null,
        enumValues: null,
        description: null,
        refColumnDefinitionId: null,
        refEntityKey: null,
      });

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
        const paths = result.error.issues.map((i: { path: unknown[] }) => i.path[0]);
        expect(paths).toContain("organizationId");
        expect(paths).toContain("key");
        expect(paths).toContain("label");
        expect(paths).toContain("type");
        expect(paths).toContain("required");
      }
    });

    it("should fail validation when key does not match regex", () => {
      const model = factory.create("system");
      model.update({
        ...validColumnFields,
        key: "InvalidKey",
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i: { path: unknown[] }) => i.path[0]);
        expect(paths).toContain("key");
      }
    });

    it("should fail validation when type is not a valid ColumnDataType", () => {
      const model = factory.create("system");
      model.update({
        ...validColumnFields,
        type: "bigint" as never,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i: { path: unknown[] }) => i.path[0]);
        expect(paths).toContain("type");
      }
    });
  });
});
