import {
  PortalResultModel,
  PortalResultModelFactory,
  PortalResultSchema,
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
  name: "Q4 Revenue Chart",
  type: "vega-lite" as const,
  content: { spec: { mark: "bar" } },
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
      name: "Q4 Revenue Chart",
      type: "vega-lite",
      content: { spec: { mark: "bar" } },
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
      name: "Summary",
      type: "text",
      content: { body: "hello" },
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

  it("should accept type \"text\"", () => {
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
      name: "Text Result",
      type: "text",
      content: { body: "Some text" },
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should accept type \"vega-lite\"", () => {
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
      name: "Chart Result",
      type: "vega-lite",
      content: { spec: { mark: "line" } },
    };
    const result = PortalResultSchema.safeParse(data);
    expect(result.success).toBe(true);
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
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validPortalResultFields);

      const json = model.toJSON();
      expect(json.organizationId).toBe("org-1");
      expect(json.stationId).toBe("station-1");
      expect(json.portalId).toBe("portal-1");
      expect(json.name).toBe("Q4 Revenue Chart");
      expect(json.type).toBe("vega-lite");
      expect(json.content).toEqual({ spec: { mark: "bar" } });
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
