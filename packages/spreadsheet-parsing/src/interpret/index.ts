import { LayoutPlanSchema } from "../plan/index.js";
import type { InterpretInput, LayoutPlan } from "../plan/index.js";
import { PLAN_VERSION } from "../plan-version.js";
import { computeWorkbookFingerprint } from "../workbook/index.js";
import type { InterpretDeps } from "./deps.js";
import { classifyFieldSegments } from "./stages/classify-field-segments.js";
import { detectHeaders } from "./stages/detect-headers.js";
import { detectIdentity } from "./stages/detect-identity.js";
import { detectRegions } from "./stages/detect-regions.js";
import { detectSegments } from "./stages/detect-segments.js";
import { proposeBindings } from "./stages/propose-bindings.js";
import { recommendSegmentAxisNames } from "./stages/recommend-segment-axis-names.js";
import { reconcileWithPrior } from "./stages/reconcile-with-prior.js";
import { scoreAndWarn } from "./stages/score-and-warn.js";
import { createInitialState } from "./state.js";
import type {
  AxisNameRecommenderFn,
  AxisNameRecommenderResult,
  ClassifierFn,
  ClassifierResult,
  ColumnClassification,
  InterpretState,
  LlmUsage,
  ParserLogger,
  RecordsAxisNameSuggestion,
} from "./types.js";

function assemblePlan(state: InterpretState): LayoutPlan {
  const perRegion: Record<string, number> = {};
  let sum = 0;
  for (const region of state.detectedRegions) {
    perRegion[region.id] = region.confidence.aggregate;
    sum += region.confidence.aggregate;
  }
  const overall =
    state.detectedRegions.length === 0 ? 0 : sum / state.detectedRegions.length;

  const plan: LayoutPlan = {
    planVersion: PLAN_VERSION,
    workbookFingerprint: computeWorkbookFingerprint({
      sheets: state.workbook.sheets.map((s) => ({
        name: s.name,
        dimensions: s.dimensions,
        // Fingerprint only reads top-left cells; reconstruct a minimal sheet.
        cells: s
          .range(1, 1, 1, 1)
          .flat()
          .filter((c): c is NonNullable<typeof c> => c !== undefined),
      })),
    }),
    regions: state.detectedRegions,
    confidence: { overall, perRegion },
  };

  return LayoutPlanSchema.parse(plan);
}

function isClassifierResult(
  out: ColumnClassification[] | ClassifierResult
): out is ClassifierResult {
  return !Array.isArray(out) && "classifications" in out;
}

function isAxisNameResult(
  out: RecordsAxisNameSuggestion | null | AxisNameRecommenderResult
): out is AxisNameRecommenderResult {
  return out !== null && typeof out === "object" && "suggestion" in out;
}

/**
 * Wrap a classifier to intercept its `usage` report (when present) while
 * preserving the plain-array return shape the stages consume.
 */
function wrapClassifierForUsage(
  classifier: ClassifierFn | undefined,
  onUsage: (usage: LlmUsage) => void
): ClassifierFn | undefined {
  if (!classifier) return undefined;
  return async (candidates, catalog) => {
    const started = Date.now();
    const out = await classifier(candidates, catalog);
    const elapsed = Date.now() - started;
    if (isClassifierResult(out)) {
      if (out.usage) onUsage(out.usage);
      else onUsage({ latencyMs: elapsed });
      return out.classifications;
    }
    onUsage({ latencyMs: elapsed });
    return out;
  };
}

function wrapRecommenderForUsage(
  recommender: AxisNameRecommenderFn | undefined,
  onUsage: (usage: LlmUsage) => void
): AxisNameRecommenderFn | undefined {
  if (!recommender) return undefined;
  return async (labels) => {
    const started = Date.now();
    const out = await recommender(labels);
    const elapsed = Date.now() - started;
    if (isAxisNameResult(out)) {
      if (out.usage) onUsage(out.usage);
      else onUsage({ latencyMs: elapsed });
      return out.suggestion;
    }
    onUsage({ latencyMs: elapsed });
    return out;
  };
}

function emitStageCompleted(
  logger: ParserLogger | undefined,
  stage: string,
  usage: LlmUsage | undefined
): void {
  if (!logger || !usage) return;
  logger.info(
    {
      event: "interpret.stage.completed",
      stage,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs: usage.latencyMs,
      modelId: usage.modelId,
    },
    `interpret stage ${stage} completed`
  );
}

/**
 * Run every stage in the order declared in
 * `SPREADSHEET_PARSING.backend.spec.md` §"interpret() — stage decomposition".
 *
 * Real LLM-backed `ClassifierFn` / `AxisNameRecommenderFn` are injected by
 * consumers in `apps/api/` (see Phase 4). When those deps return the
 * `{ classifications|suggestion, usage }` form, `interpret()` logs one
 * `interpret.stage.completed` event per dep-driven stage plus one
 * `interpret.cost.summary` at the end — provided `deps.logger` is supplied.
 */
export async function interpret(
  input: InterpretInput,
  deps: InterpretDeps = {}
): Promise<LayoutPlan> {
  const logger = deps.logger;
  let classifierUsage: LlmUsage | undefined;
  let recommenderUsage: LlmUsage | undefined;

  const wrappedDeps: InterpretDeps = {
    ...deps,
    classifier: wrapClassifierForUsage(deps.classifier, (u) => {
      classifierUsage = mergeUsage(classifierUsage, u);
    }),
    axisNameRecommender: wrapRecommenderForUsage(
      deps.axisNameRecommender,
      (u) => {
        recommenderUsage = mergeUsage(recommenderUsage, u);
      }
    ),
  };

  const interpretStarted = Date.now();
  let state = createInitialState(input);
  state = detectRegions(state);
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = detectSegments(state);
  state = await classifyFieldSegments(state, wrappedDeps);
  emitStageCompleted(logger, "classify-field-segments", classifierUsage);
  state = await recommendSegmentAxisNames(state, wrappedDeps);
  emitStageCompleted(logger, "recommend-segment-axis-names", recommenderUsage);
  state = proposeBindings(state);
  state = reconcileWithPrior(state);
  state = scoreAndWarn(state);
  const plan = assemblePlan(state);
  const totalLatencyMs = Date.now() - interpretStarted;

  if (logger) {
    const total = mergeUsage(classifierUsage, recommenderUsage);
    logger.info(
      {
        event: "interpret.cost.summary",
        totalInputTokens: total?.inputTokens,
        totalOutputTokens: total?.outputTokens,
        totalLatencyMs,
      },
      "interpret completed"
    );
  }

  return plan;
}

function mergeUsage(
  a: LlmUsage | undefined,
  b: LlmUsage | undefined
): LlmUsage | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  return {
    inputTokens:
      a.inputTokens === undefined && b.inputTokens === undefined
        ? undefined
        : (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens:
      a.outputTokens === undefined && b.outputTokens === undefined
        ? undefined
        : (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    latencyMs: a.latencyMs + b.latencyMs,
    modelId: a.modelId ?? b.modelId,
  };
}

export type { InterpretDeps } from "./deps.js";
export type {
  AxisNameRecommenderFn,
  AxisNameRecommenderResult,
  ClassifierFn,
  ClassifierCandidate,
  ClassifierResult,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
  LlmUsage,
  ParserLogger,
  RecordsAxisNameSuggestion,
} from "./deps.js";
