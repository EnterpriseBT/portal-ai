import { describe, it, expect } from "@jest/globals";

import {
  AxisNameRecommenderResponseSchema,
  ClassifierResponseSchema,
} from "../schema.js";

describe("ClassifierResponseSchema", () => {
  it("accepts a well-formed classifications array", () => {
    const out = ClassifierResponseSchema.safeParse({
      classifications: [
        {
          sourceHeader: "email",
          columnDefinitionId: "col-email",
          confidence: 0.9,
          rationale: "exact semantic match",
        },
        {
          sourceHeader: "misc",
          columnDefinitionId: null,
          confidence: 0,
        },
      ],
    });
    expect(out.success).toBe(true);
  });

  it("rejects confidence outside [0, 1]", () => {
    const out = ClassifierResponseSchema.safeParse({
      classifications: [
        { sourceHeader: "x", columnDefinitionId: "id", confidence: 1.1 },
      ],
    });
    expect(out.success).toBe(false);
  });

  it("rejects non-null-non-string columnDefinitionId", () => {
    const out = ClassifierResponseSchema.safeParse({
      classifications: [
        { sourceHeader: "x", columnDefinitionId: 42, confidence: 0.5 },
      ],
    });
    expect(out.success).toBe(false);
  });

  it("rejects missing classifications key", () => {
    const out = ClassifierResponseSchema.safeParse({});
    expect(out.success).toBe(false);
  });
});

describe("AxisNameRecommenderResponseSchema", () => {
  it("accepts { name, confidence }", () => {
    expect(
      AxisNameRecommenderResponseSchema.safeParse({
        name: "Month",
        confidence: 0.8,
      }).success
    ).toBe(true);
  });

  it("rejects empty name", () => {
    expect(
      AxisNameRecommenderResponseSchema.safeParse({
        name: "",
        confidence: 0.5,
      }).success
    ).toBe(false);
  });

  it("rejects confidence > 1", () => {
    expect(
      AxisNameRecommenderResponseSchema.safeParse({
        name: "Month",
        confidence: 1.5,
      }).success
    ).toBe(false);
  });

  it("rejects missing confidence", () => {
    expect(
      AxisNameRecommenderResponseSchema.safeParse({ name: "Month" }).success
    ).toBe(false);
  });
});
