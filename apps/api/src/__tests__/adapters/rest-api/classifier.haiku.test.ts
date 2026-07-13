import { jest, describe, it, expect } from "@jest/globals";

import { createDefaultClassifier } from "../../../adapters/rest-api/classifier.haiku.js";
import {
  ClassifierError,
  type ApiClassifierCandidate,
} from "../../../adapters/rest-api/classifier.types.js";

function makeCandidates(n: number): ApiClassifierCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    sourceField: `field_${i}`,
    inferredType: "string" as const,
    samples: [`v${i}`],
  }));
}

function makeOkResponse(
  fields: string[],
  overrides: Partial<{
    confidence: number;
    columnDefinitionId: string | null;
  }> = {}
) {
  return {
    object: {
      classifications: fields.map((f) => ({
        sourceField: f,
        columnDefinitionId: overrides.columnDefinitionId ?? null,
        suggestedNormalizedKey: f,
        suggestedSemanticType: "string",
        confidence: overrides.confidence ?? 0.8,
        rationale: `${f} rationale`,
      })),
    },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe("createDefaultClassifier — happy path", () => {
  it("returns one classification per candidate (single batch under BATCH_SIZE)", async () => {
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse(["field_0", "field_1"]));
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    const result = await classifier.classify(makeCandidates(2), []);

    expect(gen).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0].sourceField).toBe("field_0");
    expect(result[0].suggestedNormalizedKey).toBe("field_0");
    expect(result[0].confidence).toBe(0.8);
  });

  it("clamps confidence values into [0, 1]", async () => {
    const gen = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({
      object: {
        classifications: [
          {
            sourceField: "field_0",
            columnDefinitionId: null,
            suggestedNormalizedKey: "field_0",
            suggestedSemanticType: "string",
            confidence: 1.5,
            rationale: "above 1",
          },
          {
            sourceField: "field_1",
            columnDefinitionId: null,
            suggestedNormalizedKey: "field_1",
            suggestedSemanticType: "string",
            confidence: -0.2,
            rationale: "below 0",
          },
        ],
      },
    });
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    const result = await classifier.classify(makeCandidates(2), []);
    expect(result[0].confidence).toBe(1);
    expect(result[1].confidence).toBe(0);
  });

  it("drops hallucinated sourceFields not present in the candidate set", async () => {
    const gen = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({
      object: {
        classifications: [
          {
            sourceField: "field_0",
            columnDefinitionId: null,
            suggestedNormalizedKey: "field_0",
            suggestedSemanticType: "string",
            confidence: 0.5,
            rationale: "ok",
          },
          {
            sourceField: "hallucinated",
            columnDefinitionId: null,
            suggestedNormalizedKey: "hallucinated",
            suggestedSemanticType: "string",
            confidence: 0.9,
            rationale: "not in input",
          },
        ],
      },
    });
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    const result = await classifier.classify(makeCandidates(1), []);
    expect(result).toHaveLength(1);
    expect(result[0].sourceField).toBe("field_0");
  });

  it("returns an empty array (without calling the model) for zero candidates", async () => {
    const gen = jest.fn<() => Promise<unknown>>();
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    const result = await classifier.classify([], []);
    expect(result).toEqual([]);
    expect(gen).not.toHaveBeenCalled();
  });

  it("returns fewer classifications than candidates when the model drops some — caller merges by sourceField", async () => {
    // Model returns only 1 out of 2 candidates.
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(makeOkResponse(["field_0"]));
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    const result = await classifier.classify(makeCandidates(2), []);
    expect(result).toHaveLength(1);
    expect(result[0].sourceField).toBe("field_0");
  });
});

describe("createDefaultClassifier — batching + concurrency", () => {
  it("splits >8 candidates into multiple batches", async () => {
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(
        makeOkResponse(Array.from({ length: 8 }, (_, i) => `field_${i}`))
      )
      .mockResolvedValueOnce(makeOkResponse(["field_8", "field_9"]));
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    const result = await classifier.classify(makeCandidates(10), []);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(10);
  });
});

describe("createDefaultClassifier — error paths", () => {
  it("wraps a malformed response in ClassifierError('malformed-response')", async () => {
    const gen = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({
      object: { classifications: [{ totally: "wrong shape" }] },
    });
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    await expect(
      classifier.classify(makeCandidates(1), [])
    ).rejects.toMatchObject({
      name: "ClassifierError",
      reason: "malformed-response",
    });
  });

  it("wraps an AbortError as ClassifierError('timeout')", async () => {
    const abortErr = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(abortErr);
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    await expect(
      classifier.classify(makeCandidates(1), [])
    ).rejects.toMatchObject({
      name: "ClassifierError",
      reason: "timeout",
    });
  });

  it("wraps a generic throw as ClassifierError('network-error')", async () => {
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    await expect(
      classifier.classify(makeCandidates(1), [])
    ).rejects.toMatchObject({
      name: "ClassifierError",
      reason: "network-error",
    });
  });

  it("rejects with the underlying message preserved via Error.cause", async () => {
    const underlying = new Error("upstream rejected");
    const gen = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(underlying);
    const classifier = createDefaultClassifier({
      generateObject: gen as never,
    });

    try {
      await classifier.classify(makeCandidates(1), []);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ClassifierError);
      expect((err as ClassifierError).message).toContain("upstream rejected");
    }
  });
});
