import { UserModel, UserModelFactory } from "../models/user.model.js";
import { CoreModelFactory } from "../models/base.model.js";
import { DateFactory } from "../utils/date.factory.js";
import { IDFactory } from "../utils/id-factory.js";

// ── Helpers ─────────────────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic ID factory for predictable assertions. */
class StubIDFactory extends IDFactory {
  private _counter = 0;
  private _prefix: string;
  constructor(prefix: string = "stub-id") {
    super();
    this._prefix = prefix;
  }
  generate(): string {
    return `${this._prefix}-${++this._counter}`;
  }
}

/** Shared factories used across tests. */
const dateFactory = new DateFactory("UTC");

function buildCoreModelFactory(idFactory?: IDFactory) {
  return new CoreModelFactory({
    dateFactory,
    ...(idFactory ? { idFactory } : {}),
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("UserModelFactory", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a CoreModelFactory", () => {
      const coreModelFactory = buildCoreModelFactory();
      const factory = new UserModelFactory({ coreModelFactory });
      expect(factory).toBeInstanceOf(UserModelFactory);
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    let factory: UserModelFactory;
    let stubIdFactory: StubIDFactory;

    beforeEach(() => {
      stubIdFactory = new StubIDFactory("test-id");
      factory = new UserModelFactory({
        coreModelFactory: buildCoreModelFactory(stubIdFactory),
      });
    });

    it("should return a UserModel instance", () => {
      const model = factory.create("user-1");
      expect(model).toBeInstanceOf(UserModel);
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

      expect(json.updated).toBeUndefined();
      expect(json.updatedBy).toBeUndefined();
      expect(json.deleted).toBeUndefined();
      expect(json.deletedBy).toBeUndefined();
    });

    it("should produce unique ids across multiple calls", () => {
      const defaultFactory = new UserModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultFactory.create("u").toJSON().id)
      );
      expect(ids.size).toBe(50);
    });

    it("should produce ids matching UUID format when using the default IDFactory", () => {
      const defaultFactory = new UserModelFactory({
        coreModelFactory: buildCoreModelFactory(),
      });
      const model = defaultFactory.create("user-1");
      expect(model.toJSON().id).toMatch(UUID_REGEX);
    });

    it("should return a different UserModel instance on each call", () => {
      const a = factory.create("user-a");
      const b = factory.create("user-b");

      expect(a).not.toBe(b);
      expect(a.toJSON().id).not.toBe(b.toJSON().id);
    });

    it("should expose the UserSchema via the schema getter", () => {
      const model = factory.create("user-1");
      // UserSchema extends BaseModelSchema with auth0Id, email, name, picture
      const shape = model.schema.shape;
      expect(shape).toHaveProperty("auth0Id");
      expect(shape).toHaveProperty("email");
      expect(shape).toHaveProperty("name");
      expect(shape).toHaveProperty("picture");
    });

    it("should allow updating user-specific fields after creation", () => {
      const model = factory.create("user-1");
      model.update({
        auth0Id: "auth0|abc",
        email: "user@example.com",
        name: "Jane Doe",
        picture: "https://example.com/avatar.png",
      });

      const json = model.toJSON();
      expect(json.auth0Id).toBe("auth0|abc");
      expect(json.email).toBe("user@example.com");
      expect(json.name).toBe("Jane Doe");
      expect(json.picture).toBe("https://example.com/avatar.png");
      // base fields should still be present
      expect(json.id).toBe("test-id-1");
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all required fields are set", () => {
      const model = factory.create("system");
      model.update({
        auth0Id: "auth0|123",
        email: "test@test.com",
        name: "Test",
        picture: null,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation when user-specific required fields are missing", () => {
      const model = factory.create("user-1");
      // base fields are set, but auth0Id etc. are missing
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
        expect(paths).toContain("auth0Id");
      }
    });
  });
});
