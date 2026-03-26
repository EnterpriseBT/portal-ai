import {
  StationToolModel,
  StationToolModelFactory,
  StationToolSchema,
} from "../../models/station-tool.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validStationToolFields = {
  stationId: "station-1",
  organizationToolId: "ot-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("StationToolSchema", () => {
  it("should accept valid data with all fields", () => {
    const data = {
      id: "st-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      stationId: "station-1",
      organizationToolId: "ot-1",
    };
    const result = StationToolSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject missing stationId", () => {
    const data = {
      id: "st-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationToolId: "ot-1",
    };
    const result = StationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject missing organizationToolId", () => {
    const data = {
      id: "st-1",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      stationId: "station-1",
    };
    const result = StationToolSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("StationToolModelFactory", () => {
  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new StationToolModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(StationToolModelFactory);
    });
  });

  describe("create", () => {
    let factory: StationToolModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new StationToolModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a StationToolModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(StationToolModel);
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
      const defaultFactory = new StationToolModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new StationToolModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const model = defaultFactory.create("user-1");
      expect(model.toJSON().id).toMatch(UUID_REGEX);
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validStationToolFields);

      const json = model.toJSON();
      expect(json.stationId).toBe("station-1");
      expect(json.organizationToolId).toBe("ot-1");
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update(validStationToolFields);

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
        expect(paths).toContain("stationId");
        expect(paths).toContain("organizationToolId");
      }
    });
  });
});
