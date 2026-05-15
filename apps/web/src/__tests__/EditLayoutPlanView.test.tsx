import { jest } from "@jest/globals";

import type {
  LayoutPlan,
  LayoutPlanEditContextResponsePayload,
} from "@portalai/core/contracts";
import type { ServerError } from "../utils/api.util";

import { render, screen, fireEvent } from "./test-utils";
import { EditLayoutPlanViewUI } from "../views/EditLayoutPlan.view";
import type { RegionDraft } from "../modules/RegionEditor";
import { planRegionsToDrafts } from "../workflows/FileUploadConnector/utils/layout-plan-mapping.util";

const makePlan = (): LayoutPlan => ({
  planVersion: "1.0.0",
  workbookFingerprint: {
    sheetNames: ["Sheet1"],
    dimensions: { Sheet1: { rows: 2, cols: 2 } },
    anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "name" }],
  },
  regions: [
    {
      id: "r1",
      sheet: "Sheet1",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      targetEntityDefinitionId: "contacts",
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [{ kind: "field", positionCount: 2 }],
      },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 0.9,
        },
      },
      identityStrategy: { kind: "rowPosition", confidence: 0.3 },
      columnBindings: [],
      skipRules: [],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 0, action: "halt" },
      },
      confidence: { region: 0.9, aggregate: 0.9 },
      warnings: [],
    },
  ],
  confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
});

const makeEditableContext = (
  overrides: Partial<LayoutPlanEditContextResponsePayload> = {}
): LayoutPlanEditContextResponsePayload => ({
  planId: "plan_1",
  plan: makePlan(),
  connectorDefinitionSlug: "google-sheets",
  workbookPreview: {
    sheets: [
      {
        id: "sheet_0_sheet1",
        name: "Sheet1",
        dimensions: { rows: 2, cols: 2 },
        cells: [
          ["name", "age"],
          ["alice", 30],
        ],
      },
    ],
  },
  editable: true,
  ...overrides,
});

function makeEditableDraftsFromContext(
  context: LayoutPlanEditContextResponsePayload
): RegionDraft[] {
  const workbook = {
    sheets: context.workbookPreview!.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      rowCount: s.dimensions.rows,
      colCount: s.dimensions.cols,
      cells: s.cells,
    })),
  };
  return planRegionsToDrafts(context.plan, workbook);
}

const baseProps = {
  loading: false,
  loadError: null as ServerError | null,
  commitError: null as ServerError | null,
  isCommitting: false,
  connectorInstanceId: "ci_1",
  connectorInstanceName: "Test Connector",
  isSavingDraft: false,
  saveDraftToast: null as
    | { severity: "success" | "error"; message: string }
    | null,
  onDismissSaveDraftToast: jest.fn(),
  entityOptions: [],
  onCreateEntity: jest.fn(() => ""),
  regions: [] as RegionDraft[],
  activeSheetId: "sheet_0_sheet1",
  selectedRegionId: null,
  step: 0 as 0 | 1,
  onActiveSheetChange: jest.fn(),
  onSelectRegion: jest.fn(),
  onRegionDraft: jest.fn(),
  onRegionUpdate: jest.fn(),
  onRegionDelete: jest.fn(),
  onRegionResize: jest.fn(),
  onJumpToRegion: jest.fn(),
  onEditBinding: jest.fn(),
  onCommit: jest.fn(),
  onSaveDraft: jest.fn(),
  onBack: jest.fn(),
  onNavigate: jest.fn(),
};

describe("EditLayoutPlanViewUI", () => {
  // ── Case 10 ────────────────────────────────────────────────────────────
  it("case 10 — mounts RegionEditorUI when editable, with the provided regions + workbook preview", () => {
    const editContext = makeEditableContext();
    const regions = makeEditableDraftsFromContext(editContext);

    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
      />
    );

    // RegionEditorUI's stepper renders "Draw regions" and "Review" as
    // step labels — they're present iff the editable branch was taken
    // (the editable:false branch shows an Alert + re-upload link instead).
    expect(screen.getAllByText(/Draw regions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Review/i).length).toBeGreaterThan(0);
  });

  // ── Case 11 ────────────────────────────────────────────────────────────
  it("case 11 — clicking Save draft on the editor invokes the onSaveDraft prop", () => {
    const onSaveDraft = jest.fn();
    const editContext = makeEditableContext();
    const regions = makeEditableDraftsFromContext(editContext);

    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
        onSaveDraft={onSaveDraft}
      />
    );

    const saveButton = screen.getByRole("button", { name: /save draft/i });
    fireEvent.click(saveButton);

    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("case 11 — saveDraftToast renders a Snackbar with the success message", () => {
    const editContext = makeEditableContext();
    const regions = makeEditableDraftsFromContext(editContext);

    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
        saveDraftToast={{ severity: "success", message: "Plan saved." }}
      />
    );

    expect(screen.getByTestId("save-draft-toast-success")).toBeInTheDocument();
    expect(screen.getByText("Plan saved.")).toBeInTheDocument();
  });

  // ── Case 12 ────────────────────────────────────────────────────────────
  it("case 12 — clicking Commit on the review step invokes the onCommit prop", () => {
    const onCommit = jest.fn();
    const editContext = makeEditableContext();
    const regions = makeEditableDraftsFromContext(editContext);

    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
        step={1}
        onCommit={onCommit}
      />
    );

    const commitButton = screen.getByRole("button", { name: /commit/i });
    fireEvent.click(commitButton);

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // ── Case 13 ────────────────────────────────────────────────────────────
  it("case 13 — editable:false renders the notice + re-upload link, no RegionEditorUI", () => {
    const editContext = makeEditableContext({
      editable: false,
      workbookPreview: null,
      reason: {
        code: "SOURCE_REMOVED",
        message: "Source files have been cleaned up.",
      },
    });

    render(
      <EditLayoutPlanViewUI {...baseProps} editContext={editContext} />
    );

    expect(
      screen.getByText(/Source files have been cleaned up/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("reupload-link")).toBeInTheDocument();
    // No stepper from RegionEditorUI.
    expect(screen.queryByText(/Draw regions/i)).not.toBeInTheDocument();
  });

  // ── Case 14 ────────────────────────────────────────────────────────────
  it("case 14 — commitError renders the inline alert while the editor stays mounted", () => {
    const editContext = makeEditableContext();
    const regions = makeEditableDraftsFromContext(editContext);
    const commitError: ServerError = {
      message: "Blocker warnings — fix them first",
      code: "LAYOUT_PLAN_BLOCKER_WARNINGS",
    };

    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
        commitError={commitError}
      />
    );

    // Editor still mounted (stepper labels present).
    expect(screen.getAllByText(/Draw regions/i).length).toBeGreaterThan(0);
    // Inline alert text visible.
    expect(
      screen.getByText(/Blocker warnings — fix them first/i)
    ).toBeInTheDocument();
  });
});
