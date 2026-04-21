import type {
  ColumnBindingDraft,
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";
import type { ServerError } from "../../../utils/api.util";

export {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
} from "../../../modules/RegionEditor/stories/utils/region-editor-fixtures.util";

import {
  DEMO_WORKBOOK,
  PROPOSED_REGIONS,
} from "../../../modules/RegionEditor/stories/utils/region-editor-fixtures.util";

export const SPREADSHEET_FILE_EXTENSIONS = [
  ".xlsx",
  ".xls",
  ".ods",
  ".csv",
  ".tsv",
] as const;

export type UploadPhase = "idle" | "uploading" | "parsing" | "parsed" | "error";

export interface FileUploadWorkflowState {
  step: 0 | 1 | 2;
  files: File[];
  uploadPhase: UploadPhase;
  overallUploadPercent: number;
  workbook: Workbook | null;
  regions: RegionDraft[];
  selectedRegionId: string | null;
  activeSheetId: string | null;
  overallConfidence?: number;
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;
  connectorInstanceId: string | null;
  planId: string | null;
}

export const SAMPLE_FILE: File = new File(
  [new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
  "quarterly-revenue.xlsx",
  {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
);

export const SAMPLE_REGIONS: RegionDraft[] = PROPOSED_REGIONS.filter(
  (region) => region.targetEntityDefinitionId !== null
);

const FIRST_REGION = SAMPLE_REGIONS[0];
const SECOND_REGION = SAMPLE_REGIONS[1];

const GREEN_BINDINGS: ColumnBindingDraft[] = [
  {
    sourceLocator: "region_revenue_rows_as_obs!col:0",
    columnDefinitionId: "cd_region",
    columnDefinitionLabel: "Region",
    confidence: 0.94,
  },
  {
    sourceLocator: "region_revenue_rows_as_obs!col:1",
    columnDefinitionId: "cd_quarter",
    columnDefinitionLabel: "Quarter",
    confidence: 0.91,
  },
  {
    sourceLocator: "region_revenue_rows_as_obs!col:2",
    columnDefinitionId: "cd_revenue",
    columnDefinitionLabel: "Revenue",
    confidence: 0.88,
  },
];

const MIXED_BINDINGS: ColumnBindingDraft[] = [
  {
    sourceLocator: "region_revenue_cols_as_obs!row:3",
    columnDefinitionId: "cd_region",
    columnDefinitionLabel: "Region",
    confidence: 0.89,
  },
  {
    sourceLocator: "region_revenue_cols_as_obs!row:4",
    columnDefinitionId: "cd_quarter",
    columnDefinitionLabel: "Quarter",
    confidence: 0.72,
    rationale: "Header cell 'Quarter' has low similarity to canonical tokens.",
  },
  {
    sourceLocator: "region_revenue_cols_as_obs!row:5",
    columnDefinitionId: "cd_revenue",
    columnDefinitionLabel: "Revenue",
    confidence: 0.87,
  },
];

export const POST_INTERPRET_REGIONS: RegionDraft[] = [
  {
    ...FIRST_REGION,
    columnBindings: GREEN_BINDINGS,
    confidence: 0.91,
  },
  {
    ...SECOND_REGION,
    columnBindings: MIXED_BINDINGS,
    confidence: 0.78,
    warnings: [
      {
        code: "AMBIGUOUS_HEADER",
        severity: "warn",
        message: "Header 'Quarter' matches two candidate column definitions.",
        suggestedFix: "Confirm the Quarter column binding in the review step.",
      },
    ],
  },
];

const FIRST_SHEET_ID = DEMO_WORKBOOK.sheets[0].id;

export const IDLE_STATE: FileUploadWorkflowState = {
  step: 0,
  files: [],
  uploadPhase: "idle",
  overallUploadPercent: 0,
  workbook: null,
  regions: [],
  selectedRegionId: null,
  activeSheetId: null,
  serverError: null,
  isInterpreting: false,
  isCommitting: false,
  connectorInstanceId: null,
  planId: null,
};

export const UPLOADING_STATE: FileUploadWorkflowState = {
  ...IDLE_STATE,
  files: [SAMPLE_FILE],
  uploadPhase: "uploading",
  overallUploadPercent: 42,
};

export const PARSED_STATE: FileUploadWorkflowState = {
  ...IDLE_STATE,
  step: 1,
  files: [SAMPLE_FILE],
  uploadPhase: "parsed",
  overallUploadPercent: 100,
  workbook: DEMO_WORKBOOK,
  activeSheetId: FIRST_SHEET_ID,
};

export const DRAWING_STATE: FileUploadWorkflowState = {
  ...PARSED_STATE,
  regions: SAMPLE_REGIONS,
  selectedRegionId: SAMPLE_REGIONS[0].id,
  activeSheetId: SAMPLE_REGIONS[0].sheetId,
};

export const REVIEW_STATE: FileUploadWorkflowState = {
  ...DRAWING_STATE,
  step: 2,
  regions: POST_INTERPRET_REGIONS,
  selectedRegionId: null,
  activeSheetId: POST_INTERPRET_REGIONS[0].sheetId,
  overallConfidence: 0.85,
};
