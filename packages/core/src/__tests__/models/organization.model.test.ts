import {
  OrganizationModel,
  OrganizationModelFactory,
} from "../../models/organization.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Tests ───────────────────────────────────────────────────────────

describe("OrganizationModelFactory", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new OrganizationModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(OrganizationModelFactory);
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    let factory: OrganizationModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new OrganizationModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return an OrganizationModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(OrganizationModel);
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
      const defaultFactory = new OrganizationModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new OrganizationModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const model = defaultFactory.create("user-1");
      expect(model.toJSON().id).toMatch(UUID_REGEX);
    });

    it("should return a different OrganizationModel instance on each call", () => {
      const a = factory.create("user-a");
      const b = factory.create("user-b");

      expect(a).not.toBe(b);
      expect(a.toJSON().id).not.toBe(b.toJSON().id);
    });

    it("should expose the OrganizationSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("name");
      expect(shape).toHaveProperty("timezone");
    });

    it("should allow updating organization-specific fields after creation", () => {
      const model = factory.create("user-1");
      model.update({
        name: "Acme Corp",
        timezone: "America/New_York",
      });

      const json = model.toJSON();
      expect(json.name).toBe("Acme Corp");
      expect(json.timezone).toBe("America/New_York");
      // base fields should still be present
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update({
        name: "Acme Corp",
        timezone: "UTC",
        ownerUserId: "owner-123",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation when organization-specific required fields are missing", () => {
      const model = factory.create("user-1");
      // base fields are set, but name and timezone are missing
      model.update({
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain("name");
        expect(paths).toContain("timezone");
      }
    });
  });
});
