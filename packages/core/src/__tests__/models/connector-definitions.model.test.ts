import {
  ConnectorDefinitionModel,
  ConnectorDefinitionModelFactory,
  FileUploadConnectorDefinitionModel,
} from "../../models/connector-definition.model.js";
import {
  UUID_REGEX,
  StubIDFactory,
  buildCoreModelFactory,
} from "../test-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Base connector fields shared across CSV connector test helpers. */
const baseCSVConnectorFields = {
  slug: "csv-import",
  display: "CSV Import",
  category: "file",
  authType: "none",
  configSchema: null,
  capabilityFlags: { sync: true },
  isActive: true,
  version: "1.0.0",
  iconUrl: null,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ───────────────────────────────────────────────────────────

describe("ConnectorDefinitionModelFactory", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new ConnectorDefinitionModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(ConnectorDefinitionModelFactory);
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    let factory: ConnectorDefinitionModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new ConnectorDefinitionModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a ConnectorDefinitionModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(ConnectorDefinitionModel);
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
      const defaultFactory = new ConnectorDefinitionModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new ConnectorDefinitionModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const model = defaultFactory.create("user-1");
      expect(model.toJSON().id).toMatch(UUID_REGEX);
    });

    it("should return a different ConnectorDefinitionModel instance on each call", () => {
      const a = factory.create("user-a");
      const b = factory.create("user-b");

      expect(a).not.toBe(b);
      expect(a.toJSON().id).not.toBe(b.toJSON().id);
    });

    it("should expose the ConnectorDefinitionSchema via the schema getter", () => {
      const model = factory.create("user-1");
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("slug");
      expect(shape).toHaveProperty("display");
      expect(shape).toHaveProperty("category");
      expect(shape).toHaveProperty("authType");
      expect(shape).toHaveProperty("configSchema");
      expect(shape).toHaveProperty("capabilityFlags");
      expect(shape).toHaveProperty("isActive");
      expect(shape).toHaveProperty("version");
      expect(shape).toHaveProperty("iconUrl");
    });

    it("should allow updating connector-specific fields after creation", () => {
      const model = factory.create("user-1");
      model.update({
        slug: "salesforce",
        display: "Salesforce",
        category: "CRM",
        authType: "oauth2",
        configSchema: { clientId: "abc" },
        capabilityFlags: { sync: true, query: true, write: false },
        isActive: true,
        version: "1.0.0",
        iconUrl: "https://example.com/salesforce.png",
      });

      const json = model.toJSON();
      expect(json.slug).toBe("salesforce");
      expect(json.display).toBe("Salesforce");
      expect(json.category).toBe("CRM");
      expect(json.authType).toBe("oauth2");
      expect(json.configSchema).toEqual({ clientId: "abc" });
      expect(json.capabilityFlags).toEqual({ sync: true, query: true, write: false });
      expect(json.isActive).toBe(true);
      expect(json.version).toBe("1.0.0");
      expect(json.iconUrl).toBe("https://example.com/salesforce.png");
      // base fields should still be present
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update({
        slug: "hubspot",
        display: "HubSpot",
        category: "CRM",
        authType: "api_key",
        configSchema: null,
        capabilityFlags: { sync: true },
        isActive: true,
        version: "2.1.0",
        iconUrl: null,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should pass validation when configSchema is null", () => {
      const model = factory.create("system");
      model.update({
        slug: "basic-connector",
        display: "Basic Connector",
        category: "other",
        authType: "none",
        configSchema: null,
        capabilityFlags: {},
        isActive: false,
        version: "0.1.0",
        iconUrl: null,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should pass validation with partial capabilityFlags", () => {
      const model = factory.create("system");
      model.update({
        slug: "partial-flags",
        display: "Partial Flags",
        category: "integration",
        authType: "oauth2",
        configSchema: null,
        capabilityFlags: { query: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: "https://example.com/icon.svg",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.capabilityFlags).toEqual({ query: true });
      }
    });

    it("should fail validation when connector-specific required fields are missing", () => {
      const model = factory.create("user-1");
      // base fields are set, but connector fields are missing
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
        expect(paths).toContain("slug");
        expect(paths).toContain("display");
        expect(paths).toContain("category");
        expect(paths).toContain("authType");
        expect(paths).toContain("capabilityFlags");
        expect(paths).toContain("isActive");
        expect(paths).toContain("version");
      }
    });
  });
});

// ── FileUploadConnectorDefinitionModel ──────────────────────────────────────

describe("FileUploadConnectorDefinitionModel", () => {
  let factory: ConnectorDefinitionModelFactory;
  let stubIdFactory: StubIDFactory;

  beforeEach(() => {
    stubIdFactory = new StubIDFactory("csv-id");
    factory = new ConnectorDefinitionModelFactory({
      coreModelFactory: buildCoreModelFactory(stubIdFactory),
    });
  });

  it("should construct from base model JSON", () => {
    const base = factory.create("user-1");
    const model = new FileUploadConnectorDefinitionModel(base.toJSON());
    expect(model).toBeInstanceOf(FileUploadConnectorDefinitionModel);
  });

  it("should expose the FileUploadConnectorDefinitionSchema via the schema getter", () => {
    const base = factory.create("user-1");
    const model = new FileUploadConnectorDefinitionModel(base.toJSON());
    const shape = model.schema.shape;
    expect(shape).toHaveProperty("slug");
    expect(shape).toHaveProperty("display");
    expect(shape).toHaveProperty("category");
    expect(shape).toHaveProperty("authType");
    expect(shape).toHaveProperty("capabilityFlags");
    expect(shape).toHaveProperty("isActive");
    expect(shape).toHaveProperty("version");
    expect(shape).toHaveProperty("iconUrl");
    expect(shape).toHaveProperty("configSchema");
  });

  it("should pass validation with all required fields", () => {
    const base = factory.create("system");
    const model = new FileUploadConnectorDefinitionModel(base.toJSON());
    model.update({
      ...baseCSVConnectorFields,
    });

    const result = model.validate();
    expect(result.success).toBe(true);
  });

  it("should pass validation with configSchema set to null", () => {
    const base = factory.create("system");
    const model = new FileUploadConnectorDefinitionModel(base.toJSON());
    model.update({
      ...baseCSVConnectorFields,
      configSchema: null,
    });

    const result = model.validate();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configSchema).toBeNull();
    }
  });

  it("should fail validation when connector-specific required fields are missing", () => {
    const base = factory.create("user-1");
    const model = new FileUploadConnectorDefinitionModel(base.toJSON());
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
      expect(paths).toContain("slug");
    }
  });
});
