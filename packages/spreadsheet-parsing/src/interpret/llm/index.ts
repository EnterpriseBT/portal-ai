/**
 * `LlmBridge` — pure content the parser module contributes for consumers that
 * wire an LLM behind the `ClassifierFn` / `AxisNameRecommenderFn` DI slots.
 *
 * The parser module itself never calls a model, never touches the network,
 * and never imports an AI SDK. Consumers own model selection, API keys,
 * retries, timeouts, and logging. See Phase 4 of
 * `docs/SPREADSHEET_PARSING.backend.plan.md`.
 */

export {
  MAX_AXIS_LABELS,
  MAX_SHEET_SAMPLE,
  buildAxisNameRecommenderPrompt,
  buildClassifierPrompt,
} from "./prompt.js";

export {
  AxisNameRecommenderResponseSchema,
  ClassifierResponseSchema,
} from "./schema.js";
export type {
  AxisNameRecommenderResponse,
  ClassifierResponse,
} from "./schema.js";

export { sampleWorkbookRegion } from "./sampler.js";
export type { SampleBounds, SampleOptions, SampledRegion } from "./sampler.js";
