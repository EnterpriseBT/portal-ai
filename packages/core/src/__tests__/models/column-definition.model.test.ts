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
  description: "Primary email address",
  validationPattern: null,
  validationMessage: null,
  canonicalFormat: null,
  system: false,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
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
    "reference-array",
  ])("should accept '%s' as a valid type", (type) => {
    const result = ColumnDataTypeEnum.safeParse(type);
    expect(result.success).toBe(true);
  });

  it("should reject unknown types", () => {
    const result = ColumnDataTypeEnum.safeParse("bigint");
    expect(result.success).toBe(false);
  });
});

// ── ColumnDefinitionSchema system field ──────────────────────────────

describe("ColumnDefinitionSchema system field", () => {
  const minimalBase = {
    id: "cd-1",
    organizationId: "org-1",
    key: "email",
    label: "Email",
    type: "string" as const,
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    createdBy: "user-1",
    created: Date.now(),
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };

  it("requires a boolean `system` field", () => {
    const ok = ColumnDefinitionSchema.safeParse({ ...minimalBase, system: false });
    expect(ok.success).toBe(true);

    const missing: Record<string, unknown> = { ...minimalBase };
    delete missing.system;
    expect(ColumnDefinitionSchema.safeParse(missing).success).toBe(false);

    const wrong = { ...minimalBase, system: "yes" };
    expect(ColumnDefinitionSchema.safeParse(wrong).success).toBe(false);
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
      expect(shape).toHaveProperty("description");
      expect(shape).toHaveProperty("validationPattern");
      expect(shape).toHaveProperty("validationMessage");
      expect(shape).toHaveProperty("canonicalFormat");
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validColumnFields);

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.key).toBe("email");
      expect(json.label).toBe("Email");
      expect(json.type).toBe("string");
      expect(json.description).toBe("Primary email address");
      expect(json.validationPattern).toBeNull();
      expect(json.validationMessage).toBeNull();
      expect(json.canonicalFormat).toBeNull();
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

    it("should pass validation when nullable fields are null", () => {
      const model = factory.create("system");
      model.update({
        ...validColumnFields,
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
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
