import { describe, it, expect, jest, beforeEach } from "@jest/globals";

import type {
  ClassifierCandidate,
  ColumnDefinitionCatalogEntry,
} from "@portalai/core/contracts";

import {
  createInterpretDeps,
  LlmResponseError,
} from "../../services/spreadsheet-parsing-llm.service.js";

type GenerateObjectResult = {
  object: unknown;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

type GenerateObjectFn = (args: unknown) => Promise<GenerateObjectResult>;

interface CapturedLog {
  level: string;
  event: string;
  stage?: string;
  inputTokens?: number;
  outputTokens?: number;
  modelId?: string;
  latencyMs?: number;
  [k: string]: unknown;
}

function makeCapturingLogger() {
  const records: CapturedLog[] = [];
  const emit = (level: string) =>
    jest.fn((payload: unknown) => {
      if (payload && typeof payload === "object") {
        records.push({
          level,
          ...(payload as Record<string, unknown>),
        } as CapturedLog);
      }
    });
  return {
    records,
    logger: {
      info: emit("info"),
      warn: emit("warn"),
      error: emit("error"),
      debug: emit("debug"),
      trace: emit("trace"),
      fatal: emit("fatal"),
      child: () => makeCapturingLogger().logger,
    } as unknown as Parameters<typeof createInterpretDeps>[0] extends undefined
      ? never
      : NonNullable<Parameters<typeof createInterpretDeps>[0]>["logger"],
  };
}

const candidates: ClassifierCandidate[] = [
  { sourceHeader: "email", sourceCol: 1, samples: ["a@x.com"] },
  { sourceHeader: "name", sourceCol: 2, samples: ["alice"] },
];
const catalog: ColumnDefinitionCatalogEntry[] = [
  { id: "col-email", label: "Email", normalizedKey: "email" },
];

describe("createInterpretDeps — classifier", () => {
  let generateObject: jest.MockedFunction<GenerateObjectFn>;

  beforeEach(() => {
    generateObject = jest.fn();
  });

  it("calls generateObject exactly once per invocation and returns ColumnClassification[]", async () => {
    generateObject.mockResolvedValue({
      object: {
        classifications: [
          {
            sourceHeader: "email",
            columnDefinitionId: "col-email",
            confidence: 0.9,
            rationale: "ai match",
          },
          {
            sourceHeader: "name",
            columnDefinitionId: null,
            confidence: 0,
          },
        ],
      },
      usage: { inputTokens: 111, outputTokens: 22 },
    });
    const deps = createInterpretDeps({ generateObject });
    const out = await deps.classifier!(candidates, catalog);

    expect(generateObject).toHaveBeenCalledTimes(1);
    // Phase 9: classifier returns the rich `ClassifierResult` shape so the
    // parser's `interpret()` can roll usage into its cost-summary log event.
    expect(out).toMatchObject({
      classifications: [
        {
          sourceHeader: "email",
          sourceCol: 1,
          columnDefinitionId: "col-email",
          confidence: 0.9,
          rationale: "ai match",
        },
        {
          sourceHeader: "name",
          sourceCol: 2,
          columnDefinitionId: null,
          confidence: 0,
          rationale: undefined,
        },
      ],
      usage: {
        inputTokens: 111,
        outputTokens: 22,
      },
    });
  });

  it("emits a pino.info with event + stage + token counts + modelId + latencyMs", async () => {
    generateObject.mockResolvedValue({
      object: { classifications: [] },
      usage: { inputTokens: 100, outputTokens: 10 },
    });
    const cap = makeCapturingLogger();
    const deps = createInterpretDeps({
      generateObject,
      logger: cap.logger,
    });
    await deps.classifier!(candidates, catalog);

    const logged = cap.records.find(
      (r) => r.event === "interpret.llm.call" && r.stage === "classify"
    );
    expect(logged).toBeDefined();
    expect(logged?.inputTokens).toBe(100);
    expect(logged?.outputTokens).toBe(10);
    expect(typeof logged?.modelId).toBe("string");
    expect(typeof logged?.latencyMs).toBe("number");
  });

  it("throws LlmResponseError (naming the stage) when the model's output fails the Zod schema", async () => {
    generateObject.mockResolvedValue({
      object: {
        classifications: [
          {
            sourceHeader: "email",
            columnDefinitionId: 42, // wrong type
            confidence: 0.9,
          },
        ],
      },
      usage: {},
    });
    const deps = createInterpretDeps({ generateObject });
    await expect(deps.classifier!(candidates, catalog)).rejects.toMatchObject({
      name: "LlmResponseError",
      stage: "classify",
    });
  });

  it("clamps out-of-range confidence into [0, 1] on receipt", async () => {
    generateObject.mockResolvedValue({
      object: {
        classifications: [
          {
            sourceHeader: "email",
            columnDefinitionId: "col-email",
            confidence: 1.4,
          },
          {
            sourceHeader: "name",
            columnDefinitionId: null,
            confidence: -0.2,
          },
        ],
      },
      usage: {},
    });
    const deps = createInterpretDeps({ generateObject });
    const out = (await deps.classifier!(candidates, catalog)) as {
      classifications: { confidence: number }[];
    };
    expect(out.classifications[0]?.confidence).toBe(1);
    expect(out.classifications[1]?.confidence).toBe(0);
  });
});

describe("createInterpretDeps — axisNameRecommender", () => {
  let generateObject: jest.MockedFunction<GenerateObjectFn>;

  beforeEach(() => {
    generateObject = jest.fn();
  });

  it("returns null without calling the model when axisLabels is empty", async () => {
    const deps = createInterpretDeps({ generateObject });
    const out = await deps.axisNameRecommender!([]);
    expect(out).toBeNull();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("returns the validated { name, confidence } and logs with stage 'recommend-axis-name'", async () => {
    generateObject.mockResolvedValue({
      object: { name: "Month", confidence: 0.8 },
      usage: { inputTokens: 50, outputTokens: 5 },
    });
    const cap = makeCapturingLogger();
    const deps = createInterpretDeps({
      generateObject,
      logger: cap.logger,
    });
    const out = await deps.axisNameRecommender!(["Jan", "Feb", "Mar"]);
    // Phase 9: recommender returns the rich `AxisNameRecommenderResult` shape.
    expect(out).toMatchObject({
      suggestion: { name: "Month", confidence: 0.8 },
      usage: { inputTokens: 50, outputTokens: 5 },
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    const logged = cap.records.find(
      (r) =>
        r.event === "interpret.llm.call" && r.stage === "recommend-axis-name"
    );
    expect(logged).toBeDefined();
    expect(logged?.inputTokens).toBe(50);
    expect(logged?.outputTokens).toBe(5);
  });

  it("throws LlmResponseError (stage: 'recommend-axis-name') on malformed model output", async () => {
    generateObject.mockResolvedValue({
      object: { name: "", confidence: 0.5 },
      usage: {},
    });
    const deps = createInterpretDeps({ generateObject });
    await expect(deps.axisNameRecommender!(["a"])).rejects.toMatchObject({
      name: "LlmResponseError",
      stage: "recommend-axis-name",
    });
  });

  it("clamps out-of-range confidence into [0, 1] on receipt", async () => {
    generateObject.mockResolvedValue({
      object: { name: "Month", confidence: 1.5 },
      usage: {},
    });
    const deps = createInterpretDeps({ generateObject });
    const out = (await deps.axisNameRecommender!(["Jan"])) as {
      suggestion: { confidence: number };
    };
    expect(out.suggestion.confidence).toBe(1);
  });
});

describe("createInterpretDeps — configuration", () => {
  it("defaults both stages to Haiku 4.5", async () => {
    const generateObject = jest.fn<GenerateObjectFn>().mockResolvedValue({
      object: { classifications: [] },
      usage: {},
    });
    const deps = createInterpretDeps({ generateObject });
    const classifierOut = (await deps.classifier!(candidates, catalog)) as {
      usage?: { modelId?: string };
    };
    generateObject.mockResolvedValueOnce({
      object: { name: "Month", confidence: 0.8 },
      usage: {},
    });
    const axisOut = (await deps.axisNameRecommender!(["Jan"])) as {
      usage?: { modelId?: string };
    };
    expect(classifierOut.usage?.modelId).toBe("claude-haiku-4-5-20251001");
    expect(axisOut.usage?.modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("opts.classifierModel overrides only the classifier stage", async () => {
    const generateObject = jest.fn<GenerateObjectFn>().mockResolvedValue({
      object: { classifications: [] },
      usage: {},
    });
    const deps = createInterpretDeps({
      generateObject,
      classifierModel: "claude-sonnet-4-6",
    });
    const classifierOut = (await deps.classifier!(candidates, catalog)) as {
      usage?: { modelId?: string };
    };
    generateObject.mockResolvedValueOnce({
      object: { name: "Month", confidence: 0.8 },
      usage: {},
    });
    const axisOut = (await deps.axisNameRecommender!(["Jan"])) as {
      usage?: { modelId?: string };
    };
    expect(classifierOut.usage?.modelId).toBe("claude-sonnet-4-6");
    // Recommender falls back to the shared default.
    expect(axisOut.usage?.modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("opts.axisNameRecommenderModel overrides only the recommender stage", async () => {
    const generateObject = jest.fn<GenerateObjectFn>().mockResolvedValue({
      object: { classifications: [] },
      usage: {},
    });
    const deps = createInterpretDeps({
      generateObject,
      axisNameRecommenderModel: "claude-sonnet-4-6",
    });
    const classifierOut = (await deps.classifier!(candidates, catalog)) as {
      usage?: { modelId?: string };
    };
    generateObject.mockResolvedValueOnce({
      object: { name: "Month", confidence: 0.8 },
      usage: {},
    });
    const axisOut = (await deps.axisNameRecommender!(["Jan"])) as {
      usage?: { modelId?: string };
    };
    expect(classifierOut.usage?.modelId).toBe("claude-haiku-4-5-20251001");
    expect(axisOut.usage?.modelId).toBe("claude-sonnet-4-6");
  });

  it("opts.model is a shortcut that sets both stages when per-stage options are absent", async () => {
    const generateObject = jest.fn<GenerateObjectFn>().mockResolvedValue({
      object: { classifications: [] },
      usage: {},
    });
    const deps = createInterpretDeps({
      generateObject,
      model: "claude-opus-4-7",
    });
    const classifierOut = (await deps.classifier!(candidates, catalog)) as {
      usage?: { modelId?: string };
    };
    generateObject.mockResolvedValueOnce({
      object: { name: "Month", confidence: 0.8 },
      usage: {},
    });
    const axisOut = (await deps.axisNameRecommender!(["Jan"])) as {
      usage?: { modelId?: string };
    };
    expect(classifierOut.usage?.modelId).toBe("claude-opus-4-7");
    expect(axisOut.usage?.modelId).toBe("claude-opus-4-7");
  });

  it("per-stage options take precedence over the opts.model shortcut", async () => {
    const generateObject = jest.fn<GenerateObjectFn>().mockResolvedValue({
      object: { classifications: [] },
      usage: {},
    });
    const deps = createInterpretDeps({
      generateObject,
      model: "claude-opus-4-7",
      classifierModel: "claude-haiku-4-5-20251001",
    });
    const classifierOut = (await deps.classifier!(candidates, catalog)) as {
      usage?: { modelId?: string };
    };
    generateObject.mockResolvedValueOnce({
      object: { name: "Month", confidence: 0.8 },
      usage: {},
    });
    const axisOut = (await deps.axisNameRecommender!(["Jan"])) as {
      usage?: { modelId?: string };
    };
    expect(classifierOut.usage?.modelId).toBe("claude-haiku-4-5-20251001");
    // Recommender falls through the shortcut.
    expect(axisOut.usage?.modelId).toBe("claude-opus-4-7");
  });

  it("forwards opts.columnDefinitionCatalog to the InterpretDeps it returns", () => {
    const deps = createInterpretDeps({
      columnDefinitionCatalog: catalog,
    });
    expect(deps.columnDefinitionCatalog).toEqual(catalog);
  });
});
