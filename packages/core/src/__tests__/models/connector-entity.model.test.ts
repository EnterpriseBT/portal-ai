import {
  ConnectorEntityModel,
  ConnectorEntityModelFactory,
} from "../../models/connector-entity.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validEntityFields = {
  organizationId: "org-1",
  connectorInstanceId: "ci-1",
  key: "contacts",
  label: "Contacts",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("ConnectorEntityModelFactory", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new ConnectorEntityModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(ConnectorEntityModelFactory);
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    let factory: ConnectorEntityModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new ConnectorEntityModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a ConnectorEntityModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(ConnectorEntityModel);
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
      const defaultFactory = new ConnectorEntityModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new ConnectorEntityModelFactory({
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

    it("should expose the ConnectorEntitySchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("connectorInstanceId");
      expect(shape).toHaveProperty("key");
      expect(shape).toHaveProperty("label");
    });

    it("should allow updating domain fields after creation", () => {
      const model = factory.create("user-1");
      model.update(validEntityFields);

      const json = model.toJSON();
      expect(json.connectorInstanceId).toBe("ci-1");
      expect(json.key).toBe("contacts");
      expect(json.label).toBe("Contacts");
      // base fields preserved
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update(validEntityFields);

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
        expect(paths).toContain("connectorInstanceId");
        expect(paths).toContain("key");
        expect(paths).toContain("label");
      }
    });

    it("should fail validation when key does not match regex", () => {
      const model = factory.create("system");
      model.update({
        ...validEntityFields,
        key: "Invalid-Key",
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i: { path: unknown[] }) => i.path[0]);
        expect(paths).toContain("key");
      }
    });

    it("should fail validation when key starts with a digit", () => {
      const model = factory.create("system");
      model.update({
        ...validEntityFields,
        key: "1contacts",
      });

      const result = model.validate();
      expect(result.success).toBe(false);
    });
  });
});
