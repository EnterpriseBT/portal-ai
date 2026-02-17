import { z } from "zod";
import { BaseModelSchema, BaseModelClass } from "../models/base.model.js";

// ── Test fixtures ───────────────────────────────────────────────────

const TestSchema = BaseModelSchema.extend({
  name: z.string(),
});

type TestModel = z.infer<typeof TestSchema>;

class TestModelClass extends BaseModelClass<TestModel> {
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

describe("BaseModelClass", () => {
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
      const NestedSchema = BaseModelSchema.extend({
        meta: z.object({
          tags: z.array(z.string()).optional(),
          settings: z.object({
            theme: z.string(),
            notifications: z.boolean(),
          }),
        }),
      });
      type NestedModel = z.infer<typeof NestedSchema>;

      class NestedModelClass extends BaseModelClass<NestedModel> {
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
