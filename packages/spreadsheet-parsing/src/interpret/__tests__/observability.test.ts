import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../plan/index.js";
import { interpret } from "../index.js";
import type {
  AxisNameRecommenderFn,
  ClassifierFn,
  ParserLogger,
} from "../deps.js";

interface CapturedLog {
  level: "info" | "warn" | "error" | "debug";
  payload: Record<string, unknown>;
  msg?: string;
}

function makeCapturingLogger(): {
  records: CapturedLog[];
  logger: ParserLogger;
} {
  const records: CapturedLog[] = [];
  const push =
    (level: CapturedLog["level"]) =>
    (payload: Record<string, unknown>, msg?: string) =>
      records.push({ level, payload, msg });
  return {
    records,
    logger: {
      info: push("info"),
      warn: push("warn"),
      error: push("error"),
      debug: push("debug"),
    },
  };
}

function pivotedInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 4 },
          cells: [
            { row: 1, col: 1, value: "" },
            { row: 1, col: 2, value: "Jan" },
            { row: 1, col: 3, value: "Feb" },
            { row: 1, col: 4, value: "Mar" },
            { row: 2, col: 1, value: "Revenue" },
            { row: 2, col: 2, value: 100 },
            { row: 2, col: 3, value: 120 },
            { row: 2, col: 4, value: 130 },
            { row: 3, col: 1, value: "Cost" },
            { row: 3, col: 2, value: 80 },
            { row: 3, col: 3, value: 90 },
            { row: 3, col: 4, value: 95 },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 4 },
        targetEntityDefinitionId: "monthly",
        headerAxes: ["row"],
        segmentsByAxis: {
          row: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "month-seg",
              axisName: "month",
              axisNameSource: "anchor-cell",
              positionCount: 3,
            },
          ],
        },
        cellValueField: { name: "revenue", nameSource: "user" },
        axisAnchorCell: { row: 1, col: 1 },
      },
    ],
  };
}

describe("interpret() — observability", () => {
  it("emits no stage-completed events when no logger is supplied", async () => {
    // No logger → no throw; silence by default.
    await expect(interpret(pivotedInput())).resolves.toBeDefined();
  });

  it("emits interpret.stage.completed + interpret.cost.summary when classifier reports usage", async () => {
    const classifier: ClassifierFn = async (candidates) => ({
      classifications: candidates.map((c) => ({
        sourceHeader: c.sourceHeader,
        sourceCol: c.sourceCol,
        columnDefinitionId: null,
        confidence: 0,
      })),
      usage: {
        inputTokens: 120,
        outputTokens: 15,
        latencyMs: 42,
        modelId: "test-model",
      },
    });

    const { records, logger } = makeCapturingLogger();
    await interpret(pivotedInput(), { classifier, logger });

    const stageEvent = records.find(
      (r) =>
        r.payload.event === "interpret.stage.completed" &&
        r.payload.stage === "classify-columns"
    );
    expect(stageEvent).toBeDefined();
    expect(stageEvent?.payload.inputTokens).toBe(120);
    expect(stageEvent?.payload.outputTokens).toBe(15);
    expect(typeof stageEvent?.payload.latencyMs).toBe("number");
    expect(stageEvent?.payload.modelId).toBe("test-model");

    const summary = records.find(
      (r) => r.payload.event === "interpret.cost.summary"
    );
    expect(summary).toBeDefined();
    expect(summary?.payload.totalInputTokens).toBe(120);
    expect(summary?.payload.totalOutputTokens).toBe(15);
    expect(typeof summary?.payload.totalLatencyMs).toBe("number");
  });

  it("emits a stage event for recommend-records-axis-name when the recommender reports usage", async () => {
    const recommender: AxisNameRecommenderFn = async () => ({
      suggestion: { name: "Month", confidence: 0.8 },
      usage: { inputTokens: 40, outputTokens: 5, latencyMs: 20 },
    });

    const { records, logger } = makeCapturingLogger();
    await interpret(pivotedInput(), {
      axisNameRecommender: recommender,
      logger,
    });

    const stageEvent = records.find(
      (r) =>
        r.payload.event === "interpret.stage.completed" &&
        r.payload.stage === "recommend-records-axis-name"
    );
    expect(stageEvent).toBeDefined();
    expect(stageEvent?.payload.inputTokens).toBe(40);
    expect(stageEvent?.payload.outputTokens).toBe(5);
  });

  it("sums token counts across stages in the cost summary", async () => {
    const classifier: ClassifierFn = async (candidates) => ({
      classifications: candidates.map((c) => ({
        sourceHeader: c.sourceHeader,
        sourceCol: c.sourceCol,
        columnDefinitionId: null,
        confidence: 0,
      })),
      usage: { inputTokens: 100, outputTokens: 10, latencyMs: 10 },
    });
    const recommender: AxisNameRecommenderFn = async () => ({
      suggestion: { name: "Month", confidence: 0.8 },
      usage: { inputTokens: 30, outputTokens: 4, latencyMs: 5 },
    });
    const { records, logger } = makeCapturingLogger();
    await interpret(pivotedInput(), {
      classifier,
      axisNameRecommender: recommender,
      logger,
    });
    const summary = records.find(
      (r) => r.payload.event === "interpret.cost.summary"
    );
    expect(summary?.payload.totalInputTokens).toBe(130);
    expect(summary?.payload.totalOutputTokens).toBe(14);
  });

  it("still logs cost.summary even when the classifier returns the plain-array form (no usage)", async () => {
    const classifier: ClassifierFn = async () => [];
    const { records, logger } = makeCapturingLogger();
    await interpret(pivotedInput(), { classifier, logger });
    const summary = records.find(
      (r) => r.payload.event === "interpret.cost.summary"
    );
    expect(summary).toBeDefined();
    // Without usage, token counts are omitted but latencyMs still rolls up.
    expect(typeof summary?.payload.totalLatencyMs).toBe("number");
  });
});
