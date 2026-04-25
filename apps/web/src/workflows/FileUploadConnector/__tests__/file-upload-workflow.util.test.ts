import { jest, describe, test, expect } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useFileUploadWorkflow,
  FILE_UPLOAD_WORKFLOW_STEPS,
} from "../utils/file-upload-workflow.util";
import type { FileUploadWorkflowCallbacks } from "../utils/file-upload-workflow.util";
import {
  DEMO_WORKBOOK,
  SAMPLE_REGIONS,
  POST_INTERPRET_REGIONS,
} from "../utils/file-upload-fixtures.util";
import type { RegionDraft, Workbook } from "../../../modules/RegionEditor";

const SAMPLE_FILE = new File(
  [new Uint8Array([1, 2, 3])],
  "quarterly-revenue.xlsx",
  {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
);
const SECOND_FILE = new File([new Uint8Array([1, 2])], "sales.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

// Minimal plan shape — only the fields `onInterpret` writes through to the
// hook are exercised here; the atomic-commit flow keeps the plan opaque on
// the client otherwise.
const STUB_PLAN = {
  planVersion: "1.0.0",
  workbookFingerprint: { sheetNames: [], dimensions: {}, anchorCells: [] },
  regions: [],
  confidence: { overall: 0.86, perRegion: {} },
} as unknown as import("@portalai/core/contracts").LayoutPlan;

function makeCallbacks(
  overrides: Partial<FileUploadWorkflowCallbacks> = {}
): FileUploadWorkflowCallbacks {
  return {
    parseFile: jest
      .fn<FileUploadWorkflowCallbacks["parseFile"]>()
      .mockResolvedValue({
        workbook: DEMO_WORKBOOK,
        uploadSessionId: "sess_test",
      }),
    runInterpret: jest
      .fn<FileUploadWorkflowCallbacks["runInterpret"]>()
      .mockResolvedValue({
        regions: POST_INTERPRET_REGIONS,
        plan: STUB_PLAN,
        overallConfidence: 0.86,
      }),
    runCommit: jest
      .fn<FileUploadWorkflowCallbacks["runCommit"]>()
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

    expect(callbacks.parseFile).toHaveBeenCalledWith(
      [SAMPLE_FILE],
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
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
    expect(draft.bounds).toEqual({
      startRow: 0,
      endRow: 4,
      startCol: 0,
      endCol: 2,
    });
    expect(draft.id).toBeTruthy();
    expect(result.current.selectedRegionId).toBe(draft.id);
    // A freshly-drawn region is headerless so its bounds stay editable
    // until the user opts in to a header axis from the config panel.
    expect(draft.headerAxes ?? []).toEqual([]);
    expect(draft.segmentsByAxis).toBeUndefined();
  });

  test("onRegionUpdate merges the patch on the matching region", () => {
    const region = SAMPLE_REGIONS[0];
    const { result } = renderHook(() =>
      useFileUploadWorkflow(
        makeCallbacks({
          parseFile: jest
            .fn<FileUploadWorkflowCallbacks["parseFile"]>()
            .mockResolvedValue({
              workbook: DEMO_WORKBOOK,
              uploadSessionId: "sess_test",
            }),
        })
      )
    );
    act(() => result.current.addFiles([SAMPLE_FILE]));
    act(() =>
      result.current.onRegionDraft({
        sheetId: region.sheetId,
        bounds: region.bounds,
      })
    );
    const draftId = result.current.regions[0].id;

    act(() =>
      result.current.onRegionUpdate(draftId, { proposedLabel: "Renamed" })
    );
    expect(result.current.regions[0].proposedLabel).toBe("Renamed");
  });

  test("onRegionUpdate is a no-op for a missing id", () => {
    const region = SAMPLE_REGIONS[0];
    const { result } = renderHook(() => useFileUploadWorkflow(makeCallbacks()));
    act(() =>
      result.current.onRegionDraft({
        sheetId: region.sheetId,
        bounds: region.bounds,
      })
    );
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
    act(() =>
      result.current.onRegionDraft({
        sheetId: region.sheetId,
        bounds: region.bounds,
      })
    );
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
    let resolveInterpret: (payload: {
      regions: RegionDraft[];
      plan: import("@portalai/core/contracts").LayoutPlan;
      overallConfidence: number;
    }) => void = () => {};
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
        plan: STUB_PLAN,
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
    let resolveParse: (payload: {
      workbook: Workbook;
      uploadSessionId: string;
    }) => void = () => {};
    const parseFile = jest
      .fn<FileUploadWorkflowCallbacks["parseFile"]>()
      .mockImplementation(
        () =>
          new Promise<{ workbook: Workbook; uploadSessionId: string }>((r) => {
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
      resolveParse({
        workbook: DEMO_WORKBOOK,
        uploadSessionId: "sess_late",
      });
      await pending;
    });

    expect(result.current.step).toBe(0);
    expect(result.current.workbook).toBeNull();
    expect(result.current.uploadPhase).toBe("idle");
  });
});

describe("useFileUploadWorkflow — atomic commit (deferred persistence)", () => {
  test("neither parse nor interpret creates server-side state — nothing to orphan", async () => {
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

    // Plan is held in memory only — no ConnectorInstance to roll back.
    expect(result.current.plan).toBe(STUB_PLAN);
  });

  test("onInterpret hydrates `plan` in state without any extra persistence call", async () => {
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

    expect(result.current.plan).toBeNull();
    await act(async () => {
      await result.current.onInterpret();
    });
    expect(result.current.plan).toBe(STUB_PLAN);
    expect(callbacks.runInterpret).toHaveBeenCalledTimes(1);
  });

  test("onCommit forwards the stored plan to runCommit", async () => {
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
    await act(async () => {
      await result.current.onCommit();
    });

    expect(callbacks.runCommit).toHaveBeenCalledWith(STUB_PLAN);
  });

  test("onCommit is a no-op when no plan has been produced yet", async () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useFileUploadWorkflow(callbacks));
    await act(async () => {
      await result.current.onCommit();
    });
    expect(callbacks.runCommit).not.toHaveBeenCalled();
  });

  test("re-interpret after goBack overwrites the stored plan", async () => {
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
    act(() => result.current.goBack());
    await act(async () => {
      await result.current.onInterpret();
    });

    expect(callbacks.runInterpret).toHaveBeenCalledTimes(2);
    expect(result.current.plan).toBe(STUB_PLAN);
  });

  test("reset clears the stored plan", async () => {
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
    expect(result.current.plan).toBe(STUB_PLAN);

    act(() => result.current.reset());
    expect(result.current.plan).toBeNull();
  });
});

describe("useFileUploadWorkflow — binding edits", () => {
  // Fixtures for binding-edit tests. Two regions on separate sheets so we can
  // assert cross-region isolation; one binding uses `byHeaderName` locator,
  // the other uses `byPositionIndex` so both serialisation paths are exercised.
  const planRegionA = {
    id: "region-a",
    sheet: DEMO_WORKBOOK.sheets[0].name,
    bounds: { startRow: 1, endRow: 4, startCol: 1, endCol: 3 },
    targetEntityDefinitionId: "ent_contact",
    headerAxes: ["row" as const],
    segmentsByAxis: {
      row: [{ kind: "field" as const, positionCount: 3 }],
    },
    headerStrategyByAxis: {
      row: {
        kind: "row" as const,
        locator: {
          kind: "row" as const,
          sheet: DEMO_WORKBOOK.sheets[0].name,
          row: 1,
        },
        confidence: 0.95,
      },
    },
    identityStrategy: { kind: "rowPosition" as const, confidence: 0.9 },
    columnBindings: [
      {
        sourceLocator: {
          kind: "byHeaderName" as const,
          axis: "row" as const,
          name: "Email",
        },
        columnDefinitionId: "coldef_email",
        confidence: 0.9,
      },
      {
        sourceLocator: {
          kind: "byPositionIndex" as const,
          axis: "row" as const,
          index: 3,
        },
        columnDefinitionId: "coldef_name",
        confidence: 0.7,
      },
    ],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt" as const,
      removedColumns: { max: 0, action: "halt" as const },
    },
    confidence: { region: 0.9, aggregate: 0.85 },
    warnings: [],
  };
  const planRegionB = {
    ...planRegionA,
    id: "region-b",
    sheet: DEMO_WORKBOOK.sheets[1]?.name ?? DEMO_WORKBOOK.sheets[0].name,
    targetEntityDefinitionId: "ent_order",
    columnBindings: [
      {
        sourceLocator: {
          kind: "byHeaderName" as const,
          axis: "row" as const,
          name: "Total",
        },
        columnDefinitionId: "coldef_total",
        confidence: 0.95,
      },
    ],
  };

  const draftRegionA: RegionDraft = {
    id: "region-a",
    sheetId: DEMO_WORKBOOK.sheets[0].id,
    bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
    targetEntityDefinitionId: "ent_contact",
    columnBindings: [
      {
        sourceLocator: "header:row:Email",
        columnDefinitionId: "coldef_email",
        confidence: 0.9,
      },
      {
        sourceLocator: "pos:row:3",
        columnDefinitionId: "coldef_name",
        confidence: 0.7,
      },
    ],
  };
  const draftRegionB: RegionDraft = {
    id: "region-b",
    sheetId: DEMO_WORKBOOK.sheets[1]?.id ?? DEMO_WORKBOOK.sheets[0].id,
    bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
    targetEntityDefinitionId: "ent_order",
    columnBindings: [
      {
        sourceLocator: "header:row:Total",
        columnDefinitionId: "coldef_total",
        confidence: 0.95,
      },
    ],
  };

  const PLAN: import("@portalai/core/contracts").LayoutPlan = {
    planVersion: "1.0.0",
    workbookFingerprint: { sheetNames: [], dimensions: {}, anchorCells: [] },
    regions: [planRegionA, planRegionB],
    confidence: {
      overall: 0.88,
      perRegion: { "region-a": 0.85, "region-b": 0.9 },
    },
  } as unknown as import("@portalai/core/contracts").LayoutPlan;

  async function seedInterpretedState() {
    const callbacks = makeCallbacks({
      runInterpret: jest
        .fn<FileUploadWorkflowCallbacks["runInterpret"]>()
        .mockResolvedValue({
          regions: [draftRegionA, draftRegionB],
          plan: PLAN,
          overallConfidence: 0.88,
        }),
    });
    const hook = renderHook(() => useFileUploadWorkflow(callbacks));
    hook.result.current.addFiles([SAMPLE_FILE]);
    await act(async () => {
      await hook.result.current.startParse();
    });
    act(() => {
      hook.result.current.onRegionDraft({
        sheetId: DEMO_WORKBOOK.sheets[0].id,
        bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
      });
    });
    await act(async () => {
      await hook.result.current.onInterpret();
    });
    return hook;
  }

  test("onToggleBindingExcluded flips the flag on both state.regions and state.plan", async () => {
    const hook = await seedInterpretedState();
    act(() =>
      hook.result.current.onToggleBindingExcluded(
        "region-a",
        "header:row:Email",
        true
      )
    );
    const region = hook.result.current.regions.find((r) => r.id === "region-a");
    const draftBinding = region?.columnBindings?.find(
      (b) => b.sourceLocator === "header:row:Email"
    );
    expect(draftBinding?.excluded).toBe(true);

    const planRegion = hook.result.current.plan?.regions.find(
      (r) => r.id === "region-a"
    );
    const planBinding = planRegion?.columnBindings.find(
      (b) =>
        b.sourceLocator.kind === "byHeaderName" &&
        b.sourceLocator.name === "Email"
    );
    expect(planBinding?.excluded).toBe(true);
  });

  test("onUpdateBinding merges the patch onto both state.regions and state.plan", async () => {
    const hook = await seedInterpretedState();
    act(() =>
      hook.result.current.onUpdateBinding("region-a", "header:row:Email", {
        normalizedKey: "email_override",
        required: true,
      })
    );
    const draftBinding = hook.result.current.regions
      .find((r) => r.id === "region-a")
      ?.columnBindings?.find((b) => b.sourceLocator === "header:row:Email");
    expect(draftBinding).toMatchObject({
      normalizedKey: "email_override",
      required: true,
    });
    const planBinding = hook.result.current.plan?.regions
      .find((r) => r.id === "region-a")
      ?.columnBindings.find(
        (b) =>
          b.sourceLocator.kind === "byHeaderName" &&
          b.sourceLocator.name === "Email"
      );
    expect(planBinding).toMatchObject({
      normalizedKey: "email_override",
      required: true,
    });
  });

  test("matches binding by serialized sourceLocator for both byHeaderName and byPositionIndex", async () => {
    const hook = await seedInterpretedState();
    act(() =>
      hook.result.current.onToggleBindingExcluded(
        "region-a",
        "pos:row:3",
        true
      )
    );
    const draftBinding = hook.result.current.regions
      .find((r) => r.id === "region-a")
      ?.columnBindings?.find((b) => b.sourceLocator === "pos:row:3");
    expect(draftBinding?.excluded).toBe(true);

    const planBinding = hook.result.current.plan?.regions
      .find((r) => r.id === "region-a")
      ?.columnBindings.find(
        (b) =>
          b.sourceLocator.kind === "byPositionIndex" &&
          b.sourceLocator.axis === "row" &&
          b.sourceLocator.index === 3
      );
    expect(planBinding?.excluded).toBe(true);
  });

  test("leaves bindings on other regions untouched", async () => {
    const hook = await seedInterpretedState();
    act(() =>
      hook.result.current.onUpdateBinding("region-a", "header:row:Email", {
        normalizedKey: "email_override",
      })
    );
    const regionBBinding = hook.result.current.regions
      .find((r) => r.id === "region-b")
      ?.columnBindings?.find((b) => b.sourceLocator === "header:row:Total");
    expect(regionBBinding).toMatchObject({
      sourceLocator: "header:row:Total",
      columnDefinitionId: "coldef_total",
    });
    expect(regionBBinding?.normalizedKey).toBeUndefined();
  });

  test("is a no-op when regionId is unknown", async () => {
    const hook = await seedInterpretedState();
    const before = hook.result.current.regions;
    act(() =>
      hook.result.current.onUpdateBinding("region-ghost", "header:row:Email", {
        normalizedKey: "x",
      })
    );
    expect(hook.result.current.regions).toBe(before);
  });

  test("is a no-op when sourceLocator does not match any binding in the region", async () => {
    const hook = await seedInterpretedState();
    const before = hook.result.current.regions;
    act(() =>
      hook.result.current.onToggleBindingExcluded(
        "region-a",
        "header:NoSuchColumn",
        true
      )
    );
    expect(hook.result.current.regions).toBe(before);
  });

  test("is a no-op when no plan has been produced yet", () => {
    const { result } = renderHook(() =>
      useFileUploadWorkflow(makeCallbacks())
    );
    // No interpret has run; state.plan is null.
    act(() =>
      result.current.onUpdateBinding("region-a", "header:row:Email", {
        normalizedKey: "x",
      })
    );
    expect(result.current.plan).toBeNull();
  });

  // Synthetic locators issued by the review-step pivot / cellValueField
  // chips: `pivot:<segId>` updates `segment.columnDefinitionId`,
  // `cellValueField` updates `cellValueField.columnDefinitionId`. Both
  // mirror the change into state.plan.
  describe("synthetic locators (pivot + cellValueField)", () => {
    const pivotDraftRegion: RegionDraft = {
      id: "region-pivot",
      sheetId: DEMO_WORKBOOK.sheets[0].id,
      bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 3 },
      headerAxes: ["row"],
      targetEntityDefinitionId: "ent_pivot",
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 1 },
          {
            kind: "pivot",
            id: "pivot-1",
            axisName: "timestamp",
            axisNameSource: "user",
            positionCount: 3,
            columnDefinitionId: "coldef_timestamp_initial",
          },
        ],
      },
      cellValueField: {
        name: "amount",
        nameSource: "user",
        columnDefinitionId: "coldef_amount_initial",
      },
      columnBindings: [],
    };
    const pivotPlanRegion = {
      id: "region-pivot",
      sheet: DEMO_WORKBOOK.sheets[0].name,
      bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 4 },
      targetEntityDefinitionId: "ent_pivot",
      headerAxes: ["row" as const],
      segmentsByAxis: {
        row: [
          { kind: "field" as const, positionCount: 1 },
          {
            kind: "pivot" as const,
            id: "pivot-1",
            axisName: "timestamp",
            axisNameSource: "user" as const,
            positionCount: 3,
            columnDefinitionId: "coldef_timestamp_initial",
          },
        ],
      },
      cellValueField: {
        name: "amount",
        nameSource: "user" as const,
        columnDefinitionId: "coldef_amount_initial",
      },
      headerStrategyByAxis: {
        row: {
          kind: "row" as const,
          locator: {
            kind: "row" as const,
            sheet: DEMO_WORKBOOK.sheets[0].name,
            row: 1,
          },
          confidence: 0.95,
        },
      },
      identityStrategy: { kind: "rowPosition" as const, confidence: 0.6 },
      columnBindings: [],
      skipRules: [],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt" as const,
        removedColumns: { max: 0, action: "halt" as const },
      },
      confidence: { region: 0.9, aggregate: 0.85 },
      warnings: [],
    };

    async function seedPivotState() {
      const callbacks = makeCallbacks({
        runInterpret: jest
          .fn<FileUploadWorkflowCallbacks["runInterpret"]>()
          .mockResolvedValue({
            regions: [pivotDraftRegion],
            plan: {
              planVersion: "1.0.0",
              workbookFingerprint: {
                sheetNames: [],
                dimensions: {},
                anchorCells: [],
              },
              regions: [pivotPlanRegion],
              confidence: {
                overall: 0.85,
                perRegion: { "region-pivot": 0.85 },
              },
            } as unknown as import("@portalai/core/contracts").LayoutPlan,
            overallConfidence: 0.85,
          }),
      });
      const hook = renderHook(() => useFileUploadWorkflow(callbacks));
      hook.result.current.addFiles([SAMPLE_FILE]);
      await act(async () => {
        await hook.result.current.startParse();
      });
      act(() => {
        hook.result.current.onRegionDraft({
          sheetId: DEMO_WORKBOOK.sheets[0].id,
          bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 3 },
        });
      });
      await act(async () => {
        await hook.result.current.onInterpret();
      });
      return hook;
    }

    test("`pivot:<segId>` patch updates segment.columnDefinitionId on both regions and plan", async () => {
      const hook = await seedPivotState();
      act(() =>
        hook.result.current.onUpdateBinding("region-pivot", "pivot:pivot-1", {
          columnDefinitionId: "coldef_timestamp_user_pinned",
        })
      );
      const region = hook.result.current.regions.find(
        (r) => r.id === "region-pivot"
      );
      const pivotSeg = region?.segmentsByAxis?.row?.find(
        (s) => s.kind === "pivot"
      );
      expect(pivotSeg?.kind).toBe("pivot");
      if (pivotSeg?.kind === "pivot") {
        expect(pivotSeg.columnDefinitionId).toBe(
          "coldef_timestamp_user_pinned"
        );
      }
      const planRegion = hook.result.current.plan?.regions.find(
        (r) => r.id === "region-pivot"
      );
      const planPivot = planRegion?.segmentsByAxis?.row?.find(
        (s) => s.kind === "pivot"
      );
      if (planPivot?.kind === "pivot") {
        expect(planPivot.columnDefinitionId).toBe(
          "coldef_timestamp_user_pinned"
        );
      }
    });

    test("`cellValueField` patch updates cellValueField.columnDefinitionId on both regions and plan", async () => {
      const hook = await seedPivotState();
      act(() =>
        hook.result.current.onUpdateBinding(
          "region-pivot",
          "cellValueField",
          { columnDefinitionId: "coldef_amount_user_pinned" }
        )
      );
      const region = hook.result.current.regions.find(
        (r) => r.id === "region-pivot"
      );
      expect(region?.cellValueField?.columnDefinitionId).toBe(
        "coldef_amount_user_pinned"
      );
      const planRegion = hook.result.current.plan?.regions.find(
        (r) => r.id === "region-pivot"
      );
      expect(planRegion?.cellValueField?.columnDefinitionId).toBe(
        "coldef_amount_user_pinned"
      );
    });

    test("ignores non-columnDefinitionId fields on synthetic patches (no schema home)", async () => {
      const hook = await seedPivotState();
      const before = hook.result.current.regions;
      act(() =>
        hook.result.current.onUpdateBinding(
          "region-pivot",
          "pivot:pivot-1",
          // No columnDefinitionId — patch carries only override fields that
          // pivot Segment doesn't support. Should be a no-op.
          { normalizedKey: "ignored", required: true }
        )
      );
      expect(hook.result.current.regions).toBe(before);
    });
  });
});
