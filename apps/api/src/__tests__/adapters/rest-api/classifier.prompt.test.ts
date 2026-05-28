import { describe, it, expect } from "@jest/globals";

import { buildApiClassifierPrompt } from "../../../adapters/rest-api/classifier.prompt.js";

describe("buildApiClassifierPrompt", () => {
  it("emits a section per candidate with sourceField + inferredType + samples", () => {
    const prompt = buildApiClassifierPrompt({
      candidates: [
        { sourceField: "email", inferredType: "string", samples: ["alice@x.test"] },
        { sourceField: "age", inferredType: "number", samples: [21, 22, 23] },
      ],
      catalog: [],
    });

    expect(prompt).toContain('sourceField: "email"');
    expect(prompt).toContain('inferredType: "string"');
    expect(prompt).toContain('samples: ["alice@x.test"]');
    expect(prompt).toContain('sourceField: "age"');
    expect(prompt).toContain('inferredType: "number"');
    expect(prompt).toContain('samples: [21,22,23]');
  });

  it("emits the empty-catalog hint when no catalog entries are supplied", () => {
    const prompt = buildApiClassifierPrompt({
      candidates: [{ sourceField: "x", inferredType: "string", samples: ["v"] }],
      catalog: [],
    });
    expect(prompt).toContain(
      "(no catalog supplied — reply with columnDefinitionId: null for every candidate)"
    );
  });

  it("renders each catalog entry's id + label + optional normalizedKey/description/type", () => {
    const prompt = buildApiClassifierPrompt({
      candidates: [{ sourceField: "x", inferredType: "string", samples: ["v"] }],
      catalog: [
        {
          id: "cd-email",
          label: "Email",
          normalizedKey: "email",
          description: "Primary contact email",
          type: "string",
        },
      ],
    });
    expect(prompt).toContain('id: "cd-email"');
    expect(prompt).toContain('label: "Email"');
    expect(prompt).toContain('normalizedKey: "email"');
    expect(prompt).toContain('description: "Primary contact email"');
    expect(prompt).toContain('type: "string"');
  });

  it("sorts catalog entries by normalizedKey (then label) for stable output", () => {
    const prompt = buildApiClassifierPrompt({
      candidates: [],
      catalog: [
        { id: "cd-z", label: "Zeta", normalizedKey: "zeta" },
        { id: "cd-a", label: "Alpha", normalizedKey: "alpha" },
        { id: "cd-b", label: "Beta", normalizedKey: "beta" },
      ],
    });
    const indexA = prompt.indexOf('"cd-a"');
    const indexB = prompt.indexOf('"cd-b"');
    const indexZ = prompt.indexOf('"cd-z"');
    expect(indexA).toBeLessThan(indexB);
    expect(indexB).toBeLessThan(indexZ);
  });

  it("truncates string sample values past MAX_SAMPLE_VALUE_LENGTH", () => {
    const longValue = "x".repeat(200);
    const prompt = buildApiClassifierPrompt({
      candidates: [
        { sourceField: "blob", inferredType: "string", samples: [longValue] },
      ],
      catalog: [],
    });
    expect(prompt).toContain("xxxx…");
    expect(prompt).not.toContain(longValue);
  });

  it("caps the rendered samples per candidate at 5", () => {
    const prompt = buildApiClassifierPrompt({
      candidates: [
        {
          sourceField: "n",
          inferredType: "number",
          samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        },
      ],
      catalog: [],
    });
    expect(prompt).toContain('samples: [1,2,3,4,5]');
    expect(prompt).not.toContain('samples: [1,2,3,4,5,6');
  });

  it("documents the JSON response shape", () => {
    const prompt = buildApiClassifierPrompt({
      candidates: [],
      catalog: [],
    });
    expect(prompt).toContain("sourceField");
    expect(prompt).toContain("columnDefinitionId");
    expect(prompt).toContain("suggestedNormalizedKey");
    expect(prompt).toContain("suggestedSemanticType");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("rationale");
  });
});
