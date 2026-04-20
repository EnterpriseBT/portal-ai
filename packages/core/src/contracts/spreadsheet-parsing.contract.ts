/**
 * Barrel re-export of the `@portalai/spreadsheet-parsing` public surface so API
 * and web consumers validate `LayoutPlan`, `Region`, `Workbook`, etc. through a
 * single `@portalai/core/contracts` entry point. The parser module is the
 * canonical owner; this file must never introduce new types of its own.
 */

// ── Workbook + fingerprint ────────────────────────────────────────────────
export {
  WorkbookSchema,
  WorkbookCellSchema,
  SheetDataSchema,
  WorkbookFingerprintSchema,
  makeWorkbook,
  makeSheetAccessor,
  computeWorkbookFingerprint,
} from "@portalai/spreadsheet-parsing";
export type {
  Workbook,
  WorkbookData,
  WorkbookCell,
  Sheet,
  SheetData,
  SheetDimensions,
  CellValue,
  MergedRange,
  WorkbookFingerprint,
} from "@portalai/spreadsheet-parsing";

// ── Plan top-level ────────────────────────────────────────────────────────
export {
  PLAN_VERSION,
  LayoutPlanSchema,
  InterpretationTraceSchema,
  RegionSchema,
  WorkbookFingerprintSchema as LayoutPlanWorkbookFingerprintSchema,
} from "@portalai/spreadsheet-parsing";
export type {
  LayoutPlan,
  InterpretationTrace,
  Region,
} from "@portalai/spreadsheet-parsing";

// ── Enums ─────────────────────────────────────────────────────────────────
export {
  ORIENTATIONS,
  OrientationEnum,
  HEADER_AXES,
  HeaderAxisEnum,
  BOUNDS_MODES,
  BoundsModeEnum,
  AXIS_NAME_SOURCES,
  AxisNameSourceEnum,
  HEADER_STRATEGY_KINDS,
  HeaderStrategyKindEnum,
  IDENTITY_STRATEGY_KINDS,
  IdentityStrategyKindEnum,
  BINDING_SOURCE_KINDS,
  BindingSourceKindEnum,
  LOCATOR_KINDS,
  LocatorKindEnum,
  SKIP_RULE_AXES,
  SkipRuleAxisEnum,
  DRIFT_ACTIONS,
  DriftActionEnum,
  DRIFT_SEVERITIES,
  DriftSeverityEnum,
  DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT,
} from "@portalai/spreadsheet-parsing";
export type {
  Orientation,
  HeaderAxis,
  BoundsMode,
  AxisNameSource,
  HeaderStrategyKind,
  IdentityStrategyKind,
  BindingSourceKind,
  LocatorKind,
  SkipRuleAxis,
  DriftAction,
  DriftSeverity,
} from "@portalai/spreadsheet-parsing";

// ── Locators + skip rules + strategies + bindings ─────────────────────────
export {
  LocatorSchema,
  CellLocatorSchema,
  RangeLocatorSchema,
  ColumnLocatorSchema,
  RowLocatorSchema,
  SkipRuleSchema,
  AxisNameSchema,
  HeaderStrategySchema,
  IdentityStrategySchema,
  BindingSourceLocatorSchema,
  ColumnBindingSchema,
} from "@portalai/spreadsheet-parsing";
export type {
  Locator,
  SkipRule,
  AxisName,
  RecordsAxisName,
  HeaderStrategy,
  IdentityStrategy,
  BindingSourceLocator,
  ColumnBinding,
} from "@portalai/spreadsheet-parsing";

// ── Drift ─────────────────────────────────────────────────────────────────
export {
  DriftKnobsSchema,
  DriftReportSchema,
  RegionDriftSchema,
  DriftKindEnum,
  DRIFT_KINDS,
} from "@portalai/spreadsheet-parsing";
export type {
  DriftKnobs,
  DriftReport,
  RegionDrift,
  DriftKind,
} from "@portalai/spreadsheet-parsing";

// ── Warnings ──────────────────────────────────────────────────────────────
export {
  WarningSchema,
  WARNING_CODES,
  WarningCodeEnum,
  WarningCode,
  WARNING_SEVERITIES,
  WarningSeverityEnum,
  DEFAULT_WARNING_SEVERITY,
} from "@portalai/spreadsheet-parsing";
export type { Warning, WarningSeverity } from "@portalai/spreadsheet-parsing";

// ── Interpret ──────────────────────────────────────────────────────────────
export {
  InterpretInputSchema,
  RegionHintSchema,
  UserHintsSchema,
  ExtractedRecordSchema,
  ReplayResultSchema,
  interpret,
} from "@portalai/spreadsheet-parsing";
export type {
  InterpretInput,
  RegionHint,
  UserHints,
  ExtractedRecord,
  ReplayResult,
} from "@portalai/spreadsheet-parsing";

// Note: `replay()` lives in the Node-only
// `@portalai/spreadsheet-parsing/replay` subpath and is **not** re-exported
// from `@portalai/core/contracts`. Keeping it out of this barrel keeps the
// contracts entry browser-safe (Storybook/web bundle don't pull `node:crypto`).
// Node-side consumers (apps/api) import it directly:
//
//     import { replay } from "@portalai/spreadsheet-parsing/replay";

// ── Interpret DI surface (Phase 3+) ────────────────────────────────────────
export type {
  InterpretDeps,
  ClassifierFn,
  ClassifierCandidate,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
  AxisNameRecommenderFn,
  RecordsAxisNameSuggestion,
} from "@portalai/spreadsheet-parsing";

// ── LlmBridge — prompts + schemas for api-side DI (Phase 4) ────────────────
// Pure content; `@portalai/spreadsheet-parsing` never calls a model.
// Consumers import via `import { LlmBridge } from "@portalai/core/contracts"`.
export { LlmBridge } from "@portalai/spreadsheet-parsing";
