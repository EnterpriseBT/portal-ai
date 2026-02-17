import { z } from "zod";
import {
  CoreSchema,
  CoreModel,
  CoreModelFactory,
  ModelFactory,
} from "../models/base.model.js";
import { DateFactory } from "../utils/date.factory.js";
import { IDFactory } from "../utils/id-factory.js";

// ── Test fixtures ───────────────────────────────────────────────────

const TestSchema = CoreSchema.extend({
  name: z.string(),
});

type TestModel = z.infer<typeof TestSchema>;

class TestModelClass extends CoreModel<TestModel> {
  get schema() {
    return TestSchema;
  }
}

const validData: TestModel = {
  id: "abc-123",
  created: Date.now(),
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  name: "Test Entity",
};

// ── Tests ───────────────────────────────────────────────────────────

describe("CoreModel", () => {
  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should store partial data in _model", () => {
      const instance = new TestModelClass({ id: "1" } as Partial<TestModel>);
      expect(instance.toJSON()).toEqual({ id: "1" });
    });

    it("should default to an empty object when no data is provided", () => {
      const instance = new TestModelClass();
      expect(instance.toJSON()).toEqual({});
    });

    it("should accept a full model object", () => {
      const instance = new TestModelClass(validData);
      expect(instance.toJSON()).toEqual(validData);
    });
  });

  // ── toJSON ──────────────────────────────────────────────────────

  describe("toJSON", () => {
    it("should return a deep clone of the internal model", () => {
      const instance = new TestModelClass(validData);
      const json = instance.toJSON();

      expect(json).toEqual(validData);
      expect(json).not.toBe(validData); // different reference
    });

    it("should not be affected by mutations to the returned object", () => {
      const instance = new TestModelClass(validData);
      const json = instance.toJSON();
      json.name = "Mutated";

      expect(instance.toJSON().name).toBe("Test Entity");
    });
  });

  // ── schema ──────────────────────────────────────────────────────

  describe("schema", () => {
    it("should expose the Zod schema of the subclass", () => {
      const instance = new TestModelClass();
      expect(instance.schema).toBe(TestSchema);
    });
  });

  // ── validate ────────────────────────────────────────────────────

  describe("validate", () => {
    it("should return success for valid complete data", () => {
      const instance = new TestModelClass(validData);
      const result = instance.validate();

      expect(result.success).toBe(true);
    });

    it("should return failure for an empty model", () => {
      const instance = new TestModelClass();
      const result = instance.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return failure when required fields are missing", () => {
      const instance = new TestModelClass({
        id: "1",
      } as Partial<TestModel>);
      const result = instance.validate();

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain("created");
        expect(paths).toContain("createdBy");
        expect(paths).toContain("name");
      }
    });

    it("should return failure for data with wrong types", () => {
      const instance = new TestModelClass({
        ...validData,
        created: "not-a-number" as unknown as number,
      });
      const result = instance.validate();

      expect(result.success).toBe(false);
    });
  });

  // ── update ───────────────────────────────────────────────────────

  describe("update", () => {
    it("should merge partial data into the model", () => {
      const instance = new TestModelClass(validData);
      instance.update({ name: "Updated" });

      expect(instance.toJSON()).toEqual({ ...validData, name: "Updated" });
    });

    it("should overwrite scalar fields with new values", () => {
      const instance = new TestModelClass(validData);
      const now = Date.now();
      instance.update({ updated: now, updatedBy: "user-2" });

      const json = instance.toJSON();
      expect(json.updated).toBe(now);
      expect(json.updatedBy).toBe("user-2");
    });

    it("should deep merge nested objects", () => {
      const NestedSchema = CoreSchema.extend({
        meta: z.object({
          tags: z.array(z.string()).optional(),
          settings: z.object({
            theme: z.string(),
            notifications: z.boolean(),
          }),
        }),
      });
      type NestedModel = z.infer<typeof NestedSchema>;

      class NestedModelClass extends CoreModel<NestedModel> {
        get schema() {
          return NestedSchema;
        }
      }

      const instance = new NestedModelClass({
        ...validData,
        meta: { settings: { theme: "dark", notifications: true } },
      } as NestedModel);

      instance.update({
        meta: { settings: { theme: "light", notifications: true } },
      } as Partial<NestedModel>);

      const json = instance.toJSON() as NestedModel;
      expect(json.meta.settings.theme).toBe("light");
      expect(json.meta.settings.notifications).toBe(true);
    });

    it("should not mutate the original data passed to the constructor", () => {
      const original = { ...validData };
      const instance = new TestModelClass(original);
      instance.update({ name: "Changed" });

      expect(original.name).toBe("Test Entity");
    });

    it("should preserve existing fields not present in the update", () => {
      const instance = new TestModelClass(validData);
      instance.update({ name: "New Name" });

      const json = instance.toJSON();
      expect(json.id).toBe(validData.id);
      expect(json.created).toBe(validData.created);
      expect(json.createdBy).toBe(validData.createdBy);
    });
  });
});

// ── CoreModelFactory ────────────────────────────────────────────────

describe("CoreModelFactory", () => {
  const dateFactory = new DateFactory("UTC");

  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept a dateFactory and use the default UUIDv4 id factory", () => {
      const factory = new CoreModelFactory({ dateFactory });
      expect(factory).toBeInstanceOf(CoreModelFactory);
    });

    it("should accept a custom IDFactory", () => {
      const customIdFactory: IDFactory = {
        generate: () => "custom-id-123",
      } as unknown as IDFactory;

      const factory = new CoreModelFactory({
        idFactory: customIdFactory,
        dateFactory,
      });
      const model = factory.create("user-1");
      expect(model.toJSON().id).toBe("custom-id-123");
    });
  });

  // ── create ──────────────────────────────────────────────────────

  describe("create", () => {
    it("should return a CoreModel instance", () => {
      const factory = new CoreModelFactory({ dateFactory });
      const model = factory.create("user-1");

      expect(model).toBeInstanceOf(CoreModel);
    });

    it("should assign a generated id", () => {
      const factory = new CoreModelFactory({ dateFactory });
      const model = factory.create("user-1");
      const json = model.toJSON();

      expect(json.id).toBeDefined();
      expect(typeof json.id).toBe("string");
      expect(json.id!.length).toBeGreaterThan(0);
    });

    it("should generate unique ids on each call", () => {
      const factory = new CoreModelFactory({ dateFactory });
      const ids = Array.from(
        { length: 50 },
        () => factory.create("user-1").toJSON().id
      );
      const unique = new Set(ids);

      expect(unique.size).toBe(50);
    });

    it("should set the createdBy field to the provided value", () => {
      const factory = new CoreModelFactory({ dateFactory });
      const model = factory.create("admin-42");

      expect(model.toJSON().createdBy).toBe("admin-42");
    });

    it("should set the created timestamp from the dateFactory", () => {
      const factory = new CoreModelFactory({ dateFactory });
      const before = Date.now();
      const model = factory.create("user-1");
      const after = Date.now();
      const created = model.toJSON().created!;

      expect(created).toBeGreaterThanOrEqual(before);
      expect(created).toBeLessThanOrEqual(after);
    });

    it("should not set updated, updatedBy, deleted, or deletedBy", () => {
      const factory = new CoreModelFactory({ dateFactory });
      const json = factory.create("user-1").toJSON();

      expect(json.updated).toBeUndefined();
      expect(json.updatedBy).toBeUndefined();
      expect(json.deleted).toBeUndefined();
      expect(json.deletedBy).toBeUndefined();
    });

    it("should use the configured timezone for the timestamp", () => {
      const tokyoDateFactory = new DateFactory("Asia/Tokyo");
      const factory = new CoreModelFactory({ dateFactory: tokyoDateFactory });
      const model = factory.create("user-1");
      const created = model.toJSON().created!;

      // Regardless of timezone, the epoch timestamp should be close to now
      expect(Math.abs(created - Date.now())).toBeLessThan(1000);
    });

    it("should use a custom IDFactory when provided", () => {
      let callCount = 0;
      const sequentialIdFactory = {
        generate: () => `seq-${++callCount}`,
      } as unknown as IDFactory;

      const factory = new CoreModelFactory({
        idFactory: sequentialIdFactory,
        dateFactory,
      });

      expect(factory.create("u").toJSON().id).toBe("seq-1");
      expect(factory.create("u").toJSON().id).toBe("seq-2");
      expect(factory.create("u").toJSON().id).toBe("seq-3");
    });
  });
});

// ── ModelFactory ────────────────────────────────────────────────────

describe("ModelFactory", () => {
  const dateFactory = new DateFactory("UTC");

  // A concrete subclass for testing the abstract ModelFactory
  const ItemSchema = CoreSchema.extend({
    title: z.string(),
  });
  type Item = z.infer<typeof ItemSchema>;

  class ItemModel extends CoreModel<Item> {
    get schema() {
      return ItemSchema;
    }
  }

  class ItemModelFactory extends ModelFactory<Item, ItemModel> {
    create(createdBy: string): ItemModel {
      const baseModel = this._coreModelFactory.create(createdBy);
      return new ItemModel(baseModel.toJSON());
    }
  }

  function buildFactory(idFactory?: IDFactory) {
    const coreModelFactory = new CoreModelFactory({
      dateFactory,
      ...(idFactory ? { idFactory } : {}),
    });
    return new ItemModelFactory({ coreModelFactory });
  }

  // ── Constructor ─────────────────────────────────────────────────

  describe("constructor", () => {
    it("should store the coreModelFactory", () => {
      const factory = buildFactory();
      expect(factory._coreModelFactory).toBeInstanceOf(CoreModelFactory);
    });
  });

  // ── create (via concrete subclass) ──────────────────────────────

  describe("create", () => {
    it("should return the concrete model type", () => {
      const factory = buildFactory();
      const model = factory.create("user-1");

      expect(model).toBeInstanceOf(ItemModel);
      expect(model).toBeInstanceOf(CoreModel);
    });

    it("should populate base fields from CoreModelFactory", () => {
      const factory = buildFactory();
      const before = Date.now();
      const model = factory.create("admin");
      const after = Date.now();
      const json = model.toJSON();

      expect(json.id).toBeDefined();
      expect(json.createdBy).toBe("admin");
      expect(json.created).toBeGreaterThanOrEqual(before);
      expect(json.created).toBeLessThanOrEqual(after);
    });

    it("should use a custom IDFactory passed through CoreModelFactory", () => {
      let counter = 0;
      const seqIdFactory = {
        generate: () => `item-${++counter}`,
      } as unknown as IDFactory;

      const factory = buildFactory(seqIdFactory);

      expect(factory.create("u").toJSON().id).toBe("item-1");
      expect(factory.create("u").toJSON().id).toBe("item-2");
    });

    it("should allow updating domain-specific fields after creation", () => {
      const factory = buildFactory();
      const model = factory.create("user-1");
      model.update({ title: "My Item" });

      const json = model.toJSON();
      expect(json.title).toBe("My Item");
      expect(json.id).toBeDefined();
      expect(json.createdBy).toBe("user-1");
    });

    it("should pass validation when all fields are set", () => {
      const factory = buildFactory();
      const model = factory.create("user-1");
      model.update({
        title: "Complete",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = model.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation when domain-specific fields are missing", () => {
      const factory = buildFactory();
      const model = factory.create("user-1");
      // base fields present, but title is missing
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
        expect(paths).toContain("title");
      }
    });

    it("should return distinct instances on each call", () => {
      const factory = buildFactory();
      const a = factory.create("u");
      const b = factory.create("u");

      expect(a).not.toBe(b);
      expect(a.toJSON().id).not.toBe(b.toJSON().id);
    });
  });
});
