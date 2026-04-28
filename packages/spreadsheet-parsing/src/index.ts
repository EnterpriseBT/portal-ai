export { PLAN_VERSION } from "./plan-version.js";

// ── Workbook (Phase 1) ─────────────────────────────────────────────────────
export {
  WorkbookSchema,
  WorkbookCellSchema,
  SheetDataSchema,
  makeWorkbook,
  makeSheetAccessor,
  computeWorkbookFingerprint,
} from "./workbook/index.js";
export type {
  Workbook,
  WorkbookData,
  WorkbookCell,
  Sheet,
  SheetData,
  SheetDimensions,
  CellValue,
  MergedRange,
} from "./workbook/index.js";

// ── Plan (Phase 2) ─────────────────────────────────────────────────────────
export * from "./plan/index.js";

// ── Interpret (Phase 3) ────────────────────────────────────────────────────
export { interpret } from "./interpret/index.js";
export type {
  InterpretDeps,
  ClassifierFn,
  ClassifierCandidate,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
  AxisNameRecommenderFn,
  RecordsAxisNameSuggestion,
} from "./interpret/index.js";

// ── LlmBridge (Phase 4) ────────────────────────────────────────────────────
// Pure content — prompt templates, structured-output Zod schemas, and sampling
// helpers the api layer uses when wiring real LLM-backed deps. The parser
// never calls a model; consumers do, behind the DI slots exposed above.
export * as LlmBridge from "./interpret/llm/index.js";

// ── Replay ─────────────────────────────────────────────────────────────────
// `replay()` and its helpers use `node:crypto` and are **not** exported from
// the main entry — they would break browser bundles (Vite externalizes
// `node:crypto`). Node-side consumers import from the dedicated subpath:
//
//     import { replay } from "@portalai/spreadsheet-parsing/replay";
//
// See `packages/spreadsheet-parsing/src/replay/index.ts` and the package.json
// `exports["./replay"]` entry.
