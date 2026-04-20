import { describe, it, expect } from "@jest/globals";

import {
  MAX_AXIS_LABELS,
  MAX_SHEET_SAMPLE,
  buildAxisNameRecommenderPrompt,
  buildClassifierPrompt,
} from "../prompt.js";

describe("buildClassifierPrompt", () => {
  const candidates = [
    { sourceHeader: "Email", sourceCol: 1, samples: ["a@x.com", "b@x.com"] },
    { sourceHeader: "First Name", sourceCol: 2, samples: ["Alice", "Bob"] },
  ];
  const catalog = [
    {
      id: "col-email",
      label: "Email Address",
      normalizedKey: "email",
      description: "Primary email",
    },
    { id: "col-first-name", label: "First Name", normalizedKey: "first_name" },
  ];

  it("produces a deterministic string for the same input (snapshot)", () => {
    const prompt = buildClassifierPrompt({ candidates, catalog });
    expect(prompt).toMatchSnapshot();
  });

  it("returns the same string on repeated calls (pure function)", () => {
    const a = buildClassifierPrompt({ candidates, catalog });
    const b = buildClassifierPrompt({ candidates, catalog });
    expect(a).toBe(b);
  });

  it("includes each source header name and column-definition id", () => {
    const prompt = buildClassifierPrompt({ candidates, catalog });
    expect(prompt).toContain("Email");
    expect(prompt).toContain("First Name");
    expect(prompt).toContain("col-email");
    expect(prompt).toContain("col-first-name");
  });

  it("caps sample values emitted per candidate to keep the prompt bounded", () => {
    const longSamples = Array.from({ length: 200 }, (_, i) => `value-${i}`);
    const prompt = buildClassifierPrompt({
      candidates: [{ sourceHeader: "X", sourceCol: 1, samples: longSamples }],
      catalog,
    });
    // Arbitrary cap; enforced by implementation.
    expect(prompt).not.toContain("value-199");
  });

  it("handles an empty catalog gracefully (returns a prompt the model can still evaluate)", () => {
    const prompt = buildClassifierPrompt({ candidates, catalog: [] });
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("buildAxisNameRecommenderPrompt", () => {
  it("caps axis labels at MAX_AXIS_LABELS (30)", () => {
    const labels = Array.from({ length: 100 }, (_, i) => `Label-${i}`);
    const prompt = buildAxisNameRecommenderPrompt({ axisLabels: labels });
    expect(prompt).toContain("Label-0");
    expect(prompt).toContain(`Label-${MAX_AXIS_LABELS - 1}`);
    expect(prompt).not.toContain(`Label-${MAX_AXIS_LABELS}`);
    expect(prompt).not.toContain("Label-99");
  });

  it("is deterministic (snapshot)", () => {
    const prompt = buildAxisNameRecommenderPrompt({
      axisLabels: ["Jan", "Feb", "Mar", "Apr"],
    });
    expect(prompt).toMatchSnapshot();
  });

  it("exposes MAX_SHEET_SAMPLE constants for downstream sampler coordination", () => {
    expect(MAX_SHEET_SAMPLE).toEqual({ rows: 200, cols: 30 });
  });
});
