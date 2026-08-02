import {
  PortalResultModel,
  PortalResultModelFactory,
  PortalResultSchema,
  PortalResultTypeSchema,
} from "../../models/portal-result.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validPortalResultFields = {
  organizationId: "org-1",
  stationId: "station-1",
  portalId: "portal-1",
  messageId: null,
  blockIndex: null,
  name: "Q4 Revenue Table",
  type: "data-table" as const,
  content: { columns: ["quarter", "revenue"], rows: [] },
  snapshotUpdatedAt: null,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("PortalResultSchema", () => {
  it("should accept valid data with all fields", () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: "portal-1",
      messageId: null,
      blockIndex: null,
      name: "Q4 Revenue Table",
      type: "data-table",
      content: { columns: ["quarter", "revenue"], rows: [] },
      snapshotUpdatedAt: null,
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject empty name", () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: null,
      name: "",
      type: "text",
      content: {},
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should accept portalId: null", () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: null,
      messageId: null,
      blockIndex: null,
      name: "Summary",
      type: "text",
      content: { body: "hello" },
      snapshotUpdatedAt: null,
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject invalid type", () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: null,
      name: "Bad Type",
      type: "pie-chart",
      content: {},
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should accept type "text"', () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: "portal-1",
      messageId: null,
      blockIndex: null,
      name: "Text Result",
      type: "text",
      content: { body: "Some text" },
      snapshotUpdatedAt: null,
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should accept type "data-table"', () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: "portal-1",
      messageId: null,
      blockIndex: null,
      name: "Table Result",
      type: "data-table",
      content: { columns: ["a"], rows: [{ a: 1 }] },
      snapshotUpdatedAt: null,
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  // #272: the Vega tools and their result types are removed — the
  // portal-result vocabulary is `text` | `data-table` only.
  it('should reject the retired type "vega-lite"', () => {
    const result = PortalResultTypeSchema.safeParse("vega-lite");
    expect(result.success).toBe(false);
  });

  it('should reject the retired type "vega"', () => {
    const result = PortalResultTypeSchema.safeParse("vega");
    expect(result.success).toBe(false);
  });

  // #312: durable viz kinds join the pinnable vocabulary.
  it('should accept type "d3"', () => {
    const result = PortalResultTypeSchema.safeParse("d3");
    expect(result.success).toBe(true);
  });

  it('should accept type "geo"', () => {
    const result = PortalResultTypeSchema.safeParse("geo");
    expect(result.success).toBe(true);
  });

  // #312: `snapshotUpdatedAt` is required-nullable, like `messageId`.
  it("should accept a numeric snapshotUpdatedAt", () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: "portal-1",
      messageId: null,
      blockIndex: null,
      name: "Snapshotted",
      type: "d3",
      content: { program: "api.svg;", rows: [] },
      snapshotUpdatedAt: Date.now(),
    };
    expect(PortalResultSchema.safeParse(data).success).toBe(true);
  });

  it("should reject a missing snapshotUpdatedAt", () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: null,
      messageId: null,
      blockIndex: null,
      name: "No snapshot key",
      type: "text",
      content: { body: "x" },
    };
    expect(PortalResultSchema.safeParse(data).success).toBe(false);
  });

  it("should reject a non-integer snapshotUpdatedAt", () => {
    const data = {
      id: "pr-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      stationId: "station-1",
      portalId: null,
      messageId: null,
      blockIndex: null,
      name: "Bad snapshot",
      type: "text",
      content: { body: "x" },
      snapshotUpdatedAt: 1.5,
    };
    expect(PortalResultSchema.safeParse(data).success).toBe(false);
  });
});

describe("PortalResultModelFactory", () => {
  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new PortalResultModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(PortalResultModelFactory);
    });
  });

  describe("create", () => {
    let factory: PortalResultModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new PortalResultModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a PortalResultModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(PortalResultModel);
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
      const defaultFactory = new PortalResultModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new PortalResultModelFactory({
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

    it("should expose the PortalResultSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("organizationId");
      expect(shape).toHaveProperty("stationId");
      expect(shape).toHaveProperty("portalId");
      expect(shape).toHaveProperty("name");
      expect(shape).toHaveProperty("type");
      expect(shape).toHaveProperty("content");
      expect(shape).toHaveProperty("snapshotUpdatedAt");
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validPortalResultFields);

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.stationId).toBe("station-1");
      expect(json.portalId).toBe("portal-1");
      expect(json.name).toBe("Q4 Revenue Table");
      expect(json.type).toBe("data-table");
      expect(json.content).toEqual({
        columns: ["quarter", "revenue"],
        rows: [],
      });
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update(validPortalResultFields);

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
