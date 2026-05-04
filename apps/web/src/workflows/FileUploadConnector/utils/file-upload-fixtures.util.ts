import type { LayoutPlan } from "@portalai/core/contracts";

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

// Per-file upload cap. Mirrors the API's `UPLOAD_MAX_FILE_SIZE_BYTES`
// default (apps/api/src/environment.ts) so we can surface a clear error
// before the upload starts; the server still enforces the real limit.
export const MAX_UPLOAD_FILE_SIZE_BYTES = 250 * 1024 * 1024;
export const MAX_UPLOAD_FILE_SIZE_LABEL = "250 MB";

export type UploadPhase = "idle" | "uploading" | "parsing" | "parsed" | "error";

export interface FileUploadProgressEntry {
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
}

export interface FileUploadWorkflowState {
  step: 0 | 1 | 2;
  files: File[];
  uploadPhase: UploadPhase;
  overallUploadPercent: number;
  /**
   * Per-file upload progress keyed by filename. Populated by the container
   * via the `parseFile` callback's `onProgress` reporter; re-rendered live so
   * the UploadStep progress bars update smoothly.
   */
  fileProgress: Record<string, FileUploadProgressEntry>;
  workbook: Workbook | null;
  regions: RegionDraft[];
  selectedRegionId: string | null;
  activeSheetId: string | null;
  overallConfidence?: number;
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;
  /**
   * Full `LayoutPlan` returned from the interpret call — held in memory so
   * the commit action can send it to the atomic-commit endpoint. Null until
   * the first successful interpret; null again on reset.
   */
  plan: LayoutPlan | null;
  /**
   * Opaque session handle returned by the `parse-session` endpoint; passed
   * back to `interpret`/`commit` so the server resolves the workbook from
   * its cache (or re-streams from S3) instead of receiving it inline.
   */
  uploadSessionId: string | null;
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
    columnDefinitionId: "cd_employee_id",
    columnDefinitionLabel: "Employee ID",
    confidence: 0.94,
  },
  {
    sourceLocator: "region_revenue_rows_as_obs!col:1",
    columnDefinitionId: "cd_name",
    columnDefinitionLabel: "Name",
    confidence: 0.91,
  },
  {
    sourceLocator: "region_revenue_rows_as_obs!col:2",
    columnDefinitionId: "cd_department",
    columnDefinitionLabel: "Department",
    confidence: 0.88,
  },
  {
    sourceLocator: "region_revenue_rows_as_obs!col:3",
    columnDefinitionId: "cd_salary",
    columnDefinitionLabel: "Salary",
    confidence: 0.89,
  },
  {
    sourceLocator: "region_revenue_rows_as_obs!col:4",
    columnDefinitionId: "cd_hire_date",
    columnDefinitionLabel: "Hire date",
    confidence: 0.86,
  },
];

const MIXED_BINDINGS: ColumnBindingDraft[] = [
  {
    sourceLocator: "region_revenue_cols_as_obs!row:2",
    columnDefinitionId: "cd_employee_id",
    columnDefinitionLabel: "Employee ID",
    confidence: 0.89,
  },
  {
    sourceLocator: "region_revenue_cols_as_obs!row:3",
    columnDefinitionId: "cd_name",
    columnDefinitionLabel: "Name",
    confidence: 0.72,
    rationale: "Header cell 'name' has low similarity to canonical tokens.",
  },
  {
    sourceLocator: "region_revenue_cols_as_obs!row:4",
    columnDefinitionId: "cd_department",
    columnDefinitionLabel: "Department",
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
  fileProgress: {},
  workbook: null,
  regions: [],
  selectedRegionId: null,
  activeSheetId: null,
  serverError: null,
  isInterpreting: false,
  isCommitting: false,
  plan: null,
  uploadSessionId: null,
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
