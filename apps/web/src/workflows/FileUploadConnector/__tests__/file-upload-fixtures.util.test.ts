import "@testing-library/jest-dom";

import {
  validateRegions,
  hasRegionErrors,
  regionsWithErrors,
} from "../../../modules/RegionEditor";
import type {
  EntityOption,
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";

import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  SAMPLE_FILE,
  SAMPLE_REGIONS,
  POST_INTERPRET_REGIONS,
  IDLE_STATE,
  UPLOADING_STATE,
  PARSED_STATE,
  DRAWING_STATE,
  REVIEW_STATE,
  SPREADSHEET_FILE_EXTENSIONS,
} from "../utils/file-upload-fixtures.util";
import type { FileUploadWorkflowState } from "../utils/file-upload-fixtures.util";

describe("file-upload-fixtures — DEMO_WORKBOOK", () => {
  test("is a valid Workbook with at least one sheet", () => {
    const wb: Workbook = DEMO_WORKBOOK;
    expect(wb.sheets.length).toBeGreaterThan(0);
    for (const sheet of wb.sheets) {
      expect(sheet.id).toBeTruthy();
      expect(sheet.name).toBeTruthy();
      expect(sheet.cells.length).toBe(sheet.rowCount);
    }
  });
});

describe("file-upload-fixtures — ENTITY_OPTIONS", () => {
  test("is a non-empty array of EntityOption", () => {
    const opts: EntityOption[] = ENTITY_OPTIONS;
    expect(opts.length).toBeGreaterThan(0);
    for (const opt of opts) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(["db", "staged"]).toContain(opt.source);
    }
  });
});

describe("file-upload-fixtures — SAMPLE_REGIONS", () => {
  test("every region is bound to an entity and validates clean", () => {
    const regions: RegionDraft[] = SAMPLE_REGIONS;
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.targetEntityDefinitionId).toBeTruthy();
    }
    const errors = validateRegions(regions);
    expect(hasRegionErrors(errors)).toBe(false);
    expect(regionsWithErrors(regions, errors)).toEqual([]);
  });

  test("every region references a sheet in DEMO_WORKBOOK", () => {
    const sheetIds = new Set(DEMO_WORKBOOK.sheets.map((s) => s.id));
    for (const region of SAMPLE_REGIONS) {
      expect(sheetIds.has(region.sheetId)).toBe(true);
    }
  });
});

describe("file-upload-fixtures — POST_INTERPRET_REGIONS", () => {
  test("contains columnBindings across the full confidence spectrum", () => {
    const regions: RegionDraft[] = POST_INTERPRET_REGIONS;
    const allBindings = regions.flatMap((r) => r.columnBindings ?? []);
    expect(allBindings.length).toBeGreaterThan(0);
    const hasGreen = allBindings.some((b) => b.confidence >= 0.85);
    const hasYellow = allBindings.some(
      (b) => b.confidence >= 0.6 && b.confidence < 0.85
    );
    expect(hasGreen).toBe(true);
    expect(hasYellow).toBe(true);
  });

  test("every region carries a numeric overall confidence", () => {
    for (const region of POST_INTERPRET_REGIONS) {
      expect(typeof region.confidence).toBe("number");
    }
  });
});

describe("file-upload-fixtures — SAMPLE_FILE", () => {
  test("is a File instance with a spreadsheet extension and MIME type", () => {
    expect(SAMPLE_FILE).toBeInstanceOf(File);
    expect(SAMPLE_FILE.name).toMatch(/\.(xlsx|xls|ods|csv|tsv)$/i);
    expect(SAMPLE_FILE.type).toBeTruthy();
  });
});

describe("file-upload-fixtures — SPREADSHEET_FILE_EXTENSIONS", () => {
  test("covers the expected spreadsheet formats", () => {
    expect(SPREADSHEET_FILE_EXTENSIONS).toEqual(
      expect.arrayContaining([".xlsx", ".xls", ".ods", ".csv", ".tsv"])
    );
  });
});

describe("file-upload-fixtures — state snapshots", () => {
  const snapshots: Array<[string, FileUploadWorkflowState]> = [
    ["IDLE_STATE", IDLE_STATE],
    ["UPLOADING_STATE", UPLOADING_STATE],
    ["PARSED_STATE", PARSED_STATE],
    ["DRAWING_STATE", DRAWING_STATE],
    ["REVIEW_STATE", REVIEW_STATE],
  ];

  test.each(snapshots)("%s is structurally valid", (_name, state) => {
    expect([0, 1, 2]).toContain(state.step);
    expect(Array.isArray(state.files)).toBe(true);
    expect(["idle", "uploading", "parsing", "parsed", "error"]).toContain(
      state.uploadPhase
    );
    expect(Array.isArray(state.regions)).toBe(true);
    expect(typeof state.isInterpreting).toBe("boolean");
    expect(typeof state.isCommitting).toBe("boolean");
  });

  test("IDLE_STATE represents the pre-upload state", () => {
    expect(IDLE_STATE.step).toBe(0);
    expect(IDLE_STATE.files).toEqual([]);
    expect(IDLE_STATE.uploadPhase).toBe("idle");
    expect(IDLE_STATE.workbook).toBeNull();
    expect(IDLE_STATE.regions).toEqual([]);
    expect(IDLE_STATE.serverError).toBeNull();
  });

  test("UPLOADING_STATE has files and phase=uploading", () => {
    expect(UPLOADING_STATE.step).toBe(0);
    expect(UPLOADING_STATE.files.length).toBeGreaterThan(0);
    expect(UPLOADING_STATE.uploadPhase).toBe("uploading");
    expect(UPLOADING_STATE.workbook).toBeNull();
  });

  test("PARSED_STATE has a workbook and has advanced to step 1", () => {
    expect(PARSED_STATE.step).toBe(1);
    expect(PARSED_STATE.uploadPhase).toBe("parsed");
    expect(PARSED_STATE.workbook).not.toBeNull();
    expect(PARSED_STATE.regions).toEqual([]);
  });

  test("DRAWING_STATE has regions drawn on the parsed workbook", () => {
    expect(DRAWING_STATE.step).toBe(1);
    expect(DRAWING_STATE.workbook).not.toBeNull();
    expect(DRAWING_STATE.regions.length).toBeGreaterThan(0);
  });

  test("REVIEW_STATE is at step 2 with interpreted regions", () => {
    expect(REVIEW_STATE.step).toBe(2);
    expect(REVIEW_STATE.regions.length).toBeGreaterThan(0);
    expect(typeof REVIEW_STATE.overallConfidence).toBe("number");
  });
});
