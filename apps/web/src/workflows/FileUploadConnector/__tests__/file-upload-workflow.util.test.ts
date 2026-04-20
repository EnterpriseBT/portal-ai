import { jest, describe, test, expect } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useFileUploadWorkflow,
  FILE_UPLOAD_WORKFLOW_STEPS,
} from "../utils/file-upload-workflow.util";
import type {
  FileUploadWorkflowCallbacks,
} from "../utils/file-upload-workflow.util";
import {
  DEMO_WORKBOOK,
  SAMPLE_REGIONS,
  POST_INTERPRET_REGIONS,
} from "../utils/file-upload-fixtures.util";
import type {
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";

const SAMPLE_FILE = new File(
  [new Uint8Array([1, 2, 3])],
  "quarterly-revenue.xlsx",
  {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
);
const SECOND_FILE = new File(
  [new Uint8Array([1, 2])],
  "sales.xlsx",
  {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
);

function makeCallbacks(
  overrides: Partial<FileUploadWorkflowCallbacks> = {}
): FileUploadWorkflowCallbacks {
  return {
    parseFile: jest.fn<FileUploadWorkflowCallbacks["parseFile"]>()
      .mockResolvedValue(DEMO_WORKBOOK),
    runInterpret: jest.fn<FileUploadWorkflowCallbacks["runInterpret"]>()
      .mockResolvedValue({
        regions: POST_INTERPRET_REGIONS,
        overallConfidence: 0.86,
      }),
    runCommit: jest.fn<FileUploadWorkflowCallbacks["runCommit"]>()
      .mockResolvedValue({ connectorInstanceId: "ci_123" }),
    onCommitSuccess: jest.fn(),
    ...overrides,
  };
}

describe("useFileUploadWorkflow — initial state", () => {
  test("starts at step 0 with no files, no workbook, no regions", () => {
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    expect(result.current.step).toBe(0);
    expect(result.current.files).toEqual([]);
    expect(result.current.uploadPhase).toBe("idle");
    expect(result.current.workbook).toBeNull();
    expect(result.current.regions).toEqual([]);
    expect(result.current.selectedRegionId).toBeNull();
    expect(result.current.activeSheetId).toBeNull();
    expect(result.current.overallConfidence).toBeUndefined();
    expect(result.current.serverError).toBeNull();
    expect(result.current.isInterpreting).toBe(false);
    expect(result.current.isCommitting).toBe(false);
  });

  test("exposes the canonical 3-step workflow labels", () => {
    expect(FILE_UPLOAD_WORKFLOW_STEPS.map((s) => s.label)).toEqual([
      "Upload",
      "Draw regions",
      "Review",
    ]);
  });
});

describe("useFileUploadWorkflow — file management", () => {
  test("addFiles sets files and leaves step at 0", () => {
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    expect(result.current.files).toEqual([SAMPLE_FILE]);
    expect(result.current.step).toBe(0);
  });

  test("addFiles dedupes by filename", () => {
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    act(() => result.current.addFiles([SAMPLE_FILE, SECOND_FILE]));
    expect(result.current.files.map((f) => f.name)).toEqual([
      SAMPLE_FILE.name,
      SECOND_FILE.name,
    ]);
  });

  test("removeFile removes by filename", () => {
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.addFiles([SAMPLE_FILE, SECOND_FILE]));
    act(() => result.current.removeFile(SAMPLE_FILE.name));
    expect(result.current.files.map((f) => f.name)).toEqual([SECOND_FILE.name]);
  });
});

describe("useFileUploadWorkflow — startParse", () => {
  test("transitions uploading → parsed, stores workbook, auto-advances to step 1", async () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    act(() => result.current.addFiles([SAMPLE_FILE]));

    await act(async () => {
      await result.current.startParse();
    });

    expect(callbacks.parseFile).toHaveBeenCalledWith([SAMPLE_FILE]);
    expect(result.current.uploadPhase).toBe("parsed");
    expect(result.current.workbook).toBe(DEMO_WORKBOOK);
    expect(result.current.step).toBe(1);
    expect(result.current.activeSheetId).toBe(DEMO_WORKBOOK.sheets[0].id);
    expect(result.current.serverError).toBeNull();
  });

  test("startParse sets serverError on failure and stays at step 0", async () => {
    const parseFile = jest
      .fn<FileUploadWorkflowCallbacks["parseFile"]>()
      .mockRejectedValue(new Error("Malformed workbook"));
    const { result } = renderHook(() =>
      useFileUploadWorkflow(makeCallbacks({ parseFile }))
    );
    act(() => result.current.addFiles([SAMPLE_FILE]));

    await act(async () => {
      await result.current.startParse();
    });

    expect(result.current.uploadPhase).toBe("error");
    expect(result.current.step).toBe(0);
    expect(result.current.workbook).toBeNull();
    expect(result.current.serverError?.message).toBe("Malformed workbook");
  });

  test("startParse is a no-op when no files are selected", async () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    await act(async () => {
      await result.current.startParse();
    });
    expect(callbacks.parseFile).not.toHaveBeenCalled();
    expect(result.current.step).toBe(0);
  });
});

describe("useFileUploadWorkflow — region editing", () => {
  test("onRegionDraft appends a region and selects it", async () => {
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });

    const sheetId = DEMO_WORKBOOK.sheets[0].id;
    act(() =>
      result.current.onRegionDraft({
        sheetId,
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      })
    );

    expect(result.current.regions.length).toBe(1);
    const [draft] = result.current.regions;
    expect(draft.sheetId).toBe(sheetId);
    expect(draft.bounds).toEqual({ startRow: 0, endRow: 4, startCol: 0, endCol: 2 });
    expect(draft.id).toBeTruthy();
    expect(result.current.selectedRegionId).toBe(draft.id);
  });

  test("onRegionUpdate merges the patch on the matching region", () => {
    const region = SAMPLE_REGIONS[0];
    const { result } = renderHook(() =>
      useFileUploadWorkflow(
        makeCallbacks({
          parseFile: jest.fn<FileUploadWorkflowCallbacks["parseFile"]>()
            .mockResolvedValue(DEMO_WORKBOOK),
        })
      )
    );
    act(() => result.current.addFiles([SAMPLE_FILE]));
    act(() => result.current.onRegionDraft({ sheetId: region.sheetId, bounds: region.bounds }));
    const draftId = result.current.regions[0].id;

    act(() =>
      result.current.onRegionUpdate(draftId, { proposedLabel: "Renamed" })
    );
    expect(result.current.regions[0].proposedLabel).toBe("Renamed");
  });

  test("onRegionUpdate is a no-op for a missing id", () => {
    const region = SAMPLE_REGIONS[0];
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.onRegionDraft({ sheetId: region.sheetId, bounds: region.bounds }));
    const draftId = result.current.regions[0].id;

    act(() =>
      result.current.onRegionUpdate("does-not-exist", { proposedLabel: "X" })
    );
    expect(result.current.regions[0].id).toBe(draftId);
    expect(result.current.regions[0].proposedLabel).toBeUndefined();
  });

  test("onRegionDelete removes and clears selection when the deleted region was selected", () => {
    const region = SAMPLE_REGIONS[0];
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.onRegionDraft({ sheetId: region.sheetId, bounds: region.bounds }));
    const draftId = result.current.regions[0].id;
    expect(result.current.selectedRegionId).toBe(draftId);

    act(() => result.current.onRegionDelete(draftId));
    expect(result.current.regions).toEqual([]);
    expect(result.current.selectedRegionId).toBeNull();
  });

  test("onSelectRegion updates selection, onActiveSheetChange updates the active sheet", () => {
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.onSelectRegion("r_any"));
    expect(result.current.selectedRegionId).toBe("r_any");
    act(() => result.current.onActiveSheetChange("sheet_other"));
    expect(result.current.activeSheetId).toBe("sheet_other");
  });
});

describe("useFileUploadWorkflow — onInterpret", () => {
  test("blocks when there are no regions", async () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    await act(async () => {
      await result.current.onInterpret();
    });
    expect(callbacks.runInterpret).not.toHaveBeenCalled();
  });

  test("calls runInterpret, replaces regions, sets overallConfidence, advances to step 2", async () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });
    // Draft a region so onInterpret is allowed.
    act(() =>
      result.current.onRegionDraft({
        sheetId: DEMO_WORKBOOK.sheets[0].id,
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      })
    );

    await act(async () => {
      await result.current.onInterpret();
    });

    expect(callbacks.runInterpret).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe(2);
    expect(result.current.regions).toBe(POST_INTERPRET_REGIONS);
    expect(result.current.overallConfidence).toBe(0.86);
    expect(result.current.isInterpreting).toBe(false);
    expect(result.current.serverError).toBeNull();
  });

  test("sets serverError on failure and stays at step 1", async () => {
    const runInterpret = jest
      .fn<FileUploadWorkflowCallbacks["runInterpret"]>()
      .mockRejectedValue(new Error("Interpreter unavailable"));
    const { result } = renderHook(() =>
      useFileUploadWorkflow(makeCallbacks({ runInterpret }))
    );
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });
    act(() =>
      result.current.onRegionDraft({
        sheetId: DEMO_WORKBOOK.sheets[0].id,
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      })
    );

    await act(async () => {
      await result.current.onInterpret();
    });

    expect(result.current.step).toBe(1);
    expect(result.current.isInterpreting).toBe(false);
    expect(result.current.serverError?.message).toBe("Interpreter unavailable");
  });

  test("isInterpreting is true while runInterpret is in flight", async () => {
    let resolveInterpret: (payload: { regions: RegionDraft[]; overallConfidence: number }) => void = () => {};
    const runInterpret = jest
      .fn<FileUploadWorkflowCallbacks["runInterpret"]>()
      .mockImplementation(
        () =>
          new Promise((r) => {
            resolveInterpret = r;
          })
      );
    const { result } = renderHook(() =>
      useFileUploadWorkflow(makeCallbacks({ runInterpret }))
    );
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });
    act(() =>
      result.current.onRegionDraft({
        sheetId: DEMO_WORKBOOK.sheets[0].id,
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      })
    );

    let interpretPromise: Promise<void> = Promise.resolve();
    act(() => {
      interpretPromise = result.current.onInterpret();
    });
    await waitFor(() => expect(result.current.isInterpreting).toBe(true));

    await act(async () => {
      resolveInterpret({
        regions: POST_INTERPRET_REGIONS,
        overallConfidence: 0.9,
      });
      await interpretPromise;
    });
    expect(result.current.isInterpreting).toBe(false);
  });
});

describe("useFileUploadWorkflow — navigation", () => {
  test("goBack from step 2 returns to step 1 and preserves regions", async () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });
    act(() =>
      result.current.onRegionDraft({
        sheetId: DEMO_WORKBOOK.sheets[0].id,
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      })
    );
    await act(async () => {
      await result.current.onInterpret();
    });
    expect(result.current.step).toBe(2);

    act(() => result.current.goBack());
    expect(result.current.step).toBe(1);
    expect(result.current.regions).toBe(POST_INTERPRET_REGIONS);
  });

  test("goBack from step 1 returns to step 0 and preserves the parsed workbook", async () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });

    act(() => result.current.goBack());
    expect(result.current.step).toBe(0);
    expect(result.current.workbook).toBe(DEMO_WORKBOOK);
  });
});

describe("useFileUploadWorkflow — onCommit", () => {
  test("calls runCommit and fires onCommitSuccess with the new connectorInstanceId", async () => {
    const onCommitSuccess = jest.fn();
    const callbacks = makeCallbacks({ onCommitSuccess });
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });
    act(() =>
      result.current.onRegionDraft({
        sheetId: DEMO_WORKBOOK.sheets[0].id,
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      })
    );
    await act(async () => {
      await result.current.onInterpret();
    });

    await act(async () => {
      await result.current.onCommit();
    });

    expect(callbacks.runCommit).toHaveBeenCalledTimes(1);
    expect(onCommitSuccess).toHaveBeenCalledWith("ci_123");
    expect(result.current.isCommitting).toBe(false);
  });

  test("sets serverError on commit failure", async () => {
    const runCommit = jest
      .fn<FileUploadWorkflowCallbacks["runCommit"]>()
      .mockRejectedValue(new Error("Commit exploded"));
    const { result } = renderHook(() =>
      useFileUploadWorkflow(makeCallbacks({ runCommit }))
    );
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });
    act(() =>
      result.current.onRegionDraft({
        sheetId: DEMO_WORKBOOK.sheets[0].id,
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
      })
    );
    await act(async () => {
      await result.current.onInterpret();
    });

    await act(async () => {
      await result.current.onCommit();
    });

    expect(result.current.serverError?.message).toBe("Commit exploded");
    expect(result.current.isCommitting).toBe(false);
  });
});

describe("useFileUploadWorkflow — reset", () => {
  test("reset returns every field to its initial value", async () => {
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() => result.current.addFiles([SAMPLE_FILE]));
    await act(async () => {
      await result.current.startParse();
    });

    act(() => result.current.reset());

    expect(result.current.step).toBe(0);
    expect(result.current.files).toEqual([]);
    expect(result.current.workbook).toBeNull();
    expect(result.current.regions).toEqual([]);
    expect(result.current.uploadPhase).toBe("idle");
    expect(result.current.serverError).toBeNull();
  });

  test("reset during an in-flight parse ignores the late resolution", async () => {
    let resolveParse: (wb: Workbook) => void = () => {};
    const parseFile = jest
      .fn<FileUploadWorkflowCallbacks["parseFile"]>()
      .mockImplementation(
        () =>
          new Promise<Workbook>((r) => {
            resolveParse = r;
          })
      );
    const { result } = renderHook(() =>
      useFileUploadWorkflow(makeCallbacks({ parseFile }))
    );
    act(() => result.current.addFiles([SAMPLE_FILE]));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.startParse();
    });
    act(() => result.current.reset());

    await act(async () => {
      resolveParse(DEMO_WORKBOOK);
      await pending;
    });

    expect(result.current.step).toBe(0);
    expect(result.current.workbook).toBeNull();
    expect(result.current.uploadPhase).toBe("idle");
  });
});
