export { RegionEditorUI } from "./RegionEditor.component";
export type {
  RegionEditorUIProps,
  RegionEditorStep,
} from "./RegionEditor.component";

export { RegionDrawingStepUI } from "./RegionDrawingStep.component";
export type { RegionDrawingStepUIProps } from "./RegionDrawingStep.component";

export { ReviewStepUI } from "./ReviewStep.component";
export type { ReviewStepUIProps } from "./ReviewStep.component";

export { SheetCanvasUI } from "./SheetCanvas.component";
export type { SheetCanvasUIProps } from "./SheetCanvas.component";

export { RegionConfigurationPanelUI } from "./RegionConfigurationPanel.component";
export type { RegionConfigurationPanelUIProps } from "./RegionConfigurationPanel.component";

export { EntityLegendUI } from "./EntityLegend.component";
export type { EntityLegendUIProps } from "./EntityLegend.component";

export { DriftBannerUI } from "./DriftBanner.component";
export type { DriftBannerUIProps } from "./DriftBanner.component";

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
  EntityOption,
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
  validateBindingDraft,
  validateRegionBindings,
  hasAnyBindingErrors,
  hasRegionErrors,
  regionsWithErrors,
} from "./utils/region-editor-validation.util";
export type {
  RegionErrors,
  RegionEditorErrors,
  BindingErrors,
  BindingValidationContext,
  RegionBindingErrors,
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
