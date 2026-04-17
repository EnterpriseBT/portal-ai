export { RegionEditorUI } from "./RegionEditor.component";
export type { RegionEditorUIProps, RegionEditorStep } from "./RegionEditor.component";

export { RegionDrawingStep } from "./RegionDrawingStep.component";
export type { RegionDrawingStepProps } from "./RegionDrawingStep.component";

export { ReviewStep } from "./ReviewStep.component";
export type { ReviewStepProps } from "./ReviewStep.component";

export { SheetCanvas } from "./SheetCanvas.component";
export type { SheetCanvasProps } from "./SheetCanvas.component";

export { RegionSidePanel } from "./RegionSidePanel.component";
export type { RegionSidePanelProps } from "./RegionSidePanel.component";

export { EntityLegend } from "./EntityLegend.component";
export type { EntityLegendProps } from "./EntityLegend.component";

export type {
  CellCoord,
  CellBounds,
  CellValue,
  SheetPreview,
  Workbook,
  Orientation,
  HeaderAxis,
  ConfidenceBand,
  WarningSeverity,
  WarningCode,
  RegionWarning,
  IdentityStrategyKind,
  HeaderStrategyKind,
  ColumnBindingDraft,
  RecordsAxisName,
  BoundsMode,
  SkipRule,
  RegionDraft,
  RegionDriftState,
  EntityLegendEntry,
  DriftReportPreview,
} from "./utils/region-editor.types";
export { DEFAULT_UNTIL_EMPTY_TERMINATOR_COUNT } from "./utils/region-editor.types";

export {
  colIndexToLetter,
  letterToColIndex,
  formatCell,
  formatBounds,
  normalizeBounds,
  coordInBounds,
} from "./utils/a1-notation.util";

export {
  ENTITY_COLOR_PALETTE,
  colorForEntity,
  confidenceBand,
  CONFIDENCE_BAND_COLOR,
} from "./utils/region-editor-colors.util";

export {
  validateRegion,
  validateRegions,
  hasRegionErrors,
  regionsWithErrors,
} from "./utils/region-editor-validation.util";
export type {
  RegionErrors,
  RegionEditorErrors,
} from "./utils/region-editor-validation.util";

export {
  DECORATION_COLOR,
  DECORATION_LABEL,
  DECORATION_BACKGROUND_IMAGE,
  computeRegionDecorations,
  activeDecorationKinds,
} from "./utils/region-editor-decorations.util";
export type {
  DecorationKind,
  RegionDecoration,
} from "./utils/region-editor-decorations.util";
