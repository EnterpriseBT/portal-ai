import { z } from "zod";

import { validateWithSchema } from "../utils/form-validation.util";

const TestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  age: z.number().min(0, "Age must be non-negative"),
});

const NestedSchema = z.object({
  address: z.object({
    city: z.string().min(1, "City is required"),
    zip: z.string().min(1, "Zip is required"),
  }),
});

describe("validateWithSchema", () => {
  it("returns success with parsed data for valid input", () => {
    const result = validateWithSchema(TestSchema, { name: "Alice", age: 30 });
    expect(result).toEqual({ success: true, data: { name: "Alice", age: 30 } });
  });

  it("returns field-keyed errors for invalid input", () => {
    const result = validateWithSchema(TestSchema, { name: "", age: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.name).toBe("Name is required");
      expect(result.errors.age).toBe("Age must be non-negative");
    }
  });

  it("handles nested paths with dot notation", () => {
    const result = validateWithSchema(NestedSchema, {
      address: { city: "", zip: "" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors["address.city"]).toBe("City is required");
      expect(result.errors["address.zip"]).toBe("Zip is required");
    }
  });

  it("keeps first error per field when multiple issues exist", () => {
    const schema = z.object({
      value: z.string().min(3, "Too short").max(5, "Too long"),
    });
    const result = validateWithSchema(schema, { value: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.value).toBe("Too short");
    }
  });
});
