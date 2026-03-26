import {
  OrganizationToolModel,
  OrganizationToolModelFactory,
  OrganizationToolSchema,
} from "../../models/organization-tool.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validOrgToolFields = {
  organizationId: "org-1",
  name: "Custom Webhook",
  description: "Calls external API",
  parameterSchema: { type: "object", properties: { query: { type: "string" } } },
  implementation: { type: "webhook" as const, url: "https://api.example.com/hook" },
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("OrganizationToolSchema", () => {
  it("should accept valid data with all fields", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "Custom Webhook",
      description: "Calls external API",
      parameterSchema: { type: "object", properties: { query: { type: "string" } } },
      implementation: { type: "webhook" as const, url: "https://api.example.com/hook" },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject empty name", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "",
      description: null,
      parameterSchema: {},
      implementation: { type: "webhook" as const, url: "https://api.example.com/hook" },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should accept description: null", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "Tool A",
      description: null,
      parameterSchema: {},
      implementation: { type: "webhook" as const, url: "https://api.example.com/hook" },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should validate parameterSchema as a jsonb record", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "Tool A",
      description: null,
      parameterSchema: { nested: { deep: true }, list: [1, 2, 3] },
      implementation: { type: "webhook" as const, url: "https://api.example.com/hook" },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should validate implementation structure with type, url, and optional headers", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "Tool A",
      description: null,
      parameterSchema: {},
      implementation: {
        type: "webhook",
        url: "https://api.example.com/hook",
        headers: { Authorization: "Bearer token123" },
      },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject implementation with missing url", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "Tool A",
      description: null,
      parameterSchema: {},
      implementation: { type: "webhook" },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject implementation with non-url string", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "Tool A",
      description: null,
      parameterSchema: {},
      implementation: { type: "webhook", url: "not-a-url" },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject implementation with wrong type", () => {
    const data = {
      id: "ot-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      name: "Tool A",
      description: null,
      parameterSchema: {},
      implementation: { type: "http", url: "https://api.example.com/hook" },
    };
    const result = OrganizationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("OrganizationToolModelFactory", () => {
  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new OrganizationToolModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(OrganizationToolModelFactory);
    });
  });

  describe("create", () => {
    let factory: OrganizationToolModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new OrganizationToolModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return an OrganizationToolModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(OrganizationToolModel);
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
      const defaultFactory = new OrganizationToolModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new OrganizationToolModelFactory({
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

    it("should expose the OrganizationToolSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("organizationId");
      expect(shape).toHaveProperty("name");
      expect(shape).toHaveProperty("description");
      expect(shape).toHaveProperty("parameterSchema");
      expect(shape).toHaveProperty("implementation");
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validOrgToolFields);

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.name).toBe("Custom Webhook");
      expect(json.description).toBe("Calls external API");
      expect(json.parameterSchema).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
      });
      expect(json.implementation).toEqual({
        type: "webhook",
        url: "https://api.example.com/hook",
      });
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update(validOrgToolFields);

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
        expect(paths).toContain("name");
      }
    });
  });
});
