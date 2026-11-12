import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import type {
  LayoutPlan,
  LayoutPlanEditContextResponsePayload,
} from "@portalai/core/contracts";
import type { ServerError } from "../utils/api.util";

import { render, screen, fireEvent, within } from "./test-utils";
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
  entityCatalog: [{ id: "contacts", label: "Contacts" }],
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
  canWrite: true,
  commitBlockedReason: null as string | null,
  connectorInstanceId: "ci_1",
  connectorInstanceName: "Test Connector",
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
  onCommit: jest.fn(),
  onBack: jest.fn(),
  onLeaveView: jest.fn(),
  onNavigate: jest.fn(),
  onInterpret: jest.fn(),
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

  // ── Case 11 — removed by #293 ──────────────────────────────────────────
  // The UI no longer owns a toast. `saveDraftToast` / `onDismissSaveDraftToast`
  // were props on this component and rendered a local Snackbar; PATCH-phase
  // errors now raise through `useToast()` in the container, and the rendering
  // itself is covered by ToastHost.test.tsx + Toast.provider.test.tsx. There is
  // nothing left to assert at this level.

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

  // #789: the review step is a form around Commit plan, here as in the
  // wizards (this view renders the same step outside any dialog).
  it("Enter on the focused Commit plan commits", async () => {
    const user = userEvent.setup();
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
    screen.getByRole("button", { name: /commit/i }).focus();
    await user.keyboard("{Enter}");
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

    render(<EditLayoutPlanViewUI {...baseProps} editContext={editContext} />);

    expect(
      screen.getByText(/Source files have been cleaned up/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("reupload-link")).toHaveAttribute(
      "href",
      "/connectors"
    );
    // No stepper from RegionEditorUI.
    expect(screen.queryByText(/Draw regions/i)).not.toBeInTheDocument();
  });

  // ── #689: no write on the instance → no editor ─────────────────────────
  it("renders a no-write-access notice instead of the editor without write", () => {
    const editContext = makeEditableContext();
    const regions = makeEditableDraftsFromContext(editContext);

    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
        canWrite={false}
      />
    );

    expect(
      screen.getByText(/You don.t have write access to this connector/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Draw regions/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("reupload-link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  // ── #689: a running job blocks Commit, naming the job ───────────────────
  it("blocks Commit with the lock reason while a job holds the connector", () => {
    const onCommit = jest.fn();
    const editContext = makeEditableContext();
    const regions = makeEditableDraftsFromContext(editContext);
    const reason =
      "Sync is running on this connector — try again when it finishes.";

    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
        step={1}
        onCommit={onCommit}
        commitBlockedReason={reason}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(reason)).toBeInTheDocument();
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

describe("EditLayoutPlanViewUI — the review step's binding editor (#795)", () => {
  it("a chip opens the binding editor, and Omit excludes the binding", async () => {
    const editContext = makeEditableContext();
    const [draft] = makeEditableDraftsFromContext(editContext);
    const regions: RegionDraft[] = [
      {
        ...draft,
        columnBindings: [
          {
            sourceLocator: "header:name",
            columnDefinitionId: "cd_name",
            columnDefinitionLabel: "Name",
            confidence: 0.9,
          },
        ],
      },
    ];
    const onUpdateBinding = jest.fn();
    const onToggleBindingExcluded = jest.fn();
    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={regions}
        step={1}
        bindingEditor={{
          onUpdateBinding,
          onToggleBindingExcluded,
          columnDefinitionSearch: {
            onSearch: jest.fn(async () => []),
            onSearchPending: false,
            onSearchError: null,
            getById: jest.fn(async () => null),
            getByIdPending: false,
            getByIdError: null,
            labelMap: {},
          },
        }}
      />
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Edit binding: header:name (bound to Name)",
      })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit column binding",
    });
    await userEvent.click(
      within(dialog).getByRole("checkbox", {
        name: /omit this column from the entity/i,
      })
    );
    expect(onToggleBindingExcluded).toHaveBeenCalledWith(
      draft.id,
      "header:name",
      true
    );
  });
});

// #1009: regions whose sheet is gone are listed above the editor, and
// Interpret waits until they're resolved.
describe("EditLayoutPlanViewUI — regions whose sheet is missing", () => {
  const orphan = {
    region: { id: "r9" } as never,
    sheetName: "Q3",
    boundsA1: "B2:F40",
    targetEntityLabel: "Contacts",
  };

  it("lists them above the editor", () => {
    const editContext = makeEditableContext();
    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={makeEditableDraftsFromContext(editContext)}
        orphans={[orphan]}
        onMoveOrphan={jest.fn()}
        onDeleteOrphan={jest.fn()}
      />
    );
    expect(
      screen.getByRole("region", { name: "Regions whose sheet is missing" })
    ).toHaveTextContent('B2:F40 (Contacts) was on sheet "Q3"');
  });

  it("refuses Interpret while any remain, and focuses the list", () => {
    const editContext = makeEditableContext();
    const onInterpret = jest.fn();
    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={makeEditableDraftsFromContext(editContext)}
        orphans={[orphan]}
        onMoveOrphan={jest.fn()}
        onDeleteOrphan={jest.fn()}
        onInterpret={onInterpret}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Interpret/ }));
    expect(onInterpret).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Regions whose sheet is missing" })
    ).toHaveFocus();
  });

  it("interprets as before when none remain", () => {
    const editContext = makeEditableContext();
    const onInterpret = jest.fn();
    render(
      <EditLayoutPlanViewUI
        {...baseProps}
        editContext={editContext}
        regions={makeEditableDraftsFromContext(editContext)}
        orphans={[]}
        onMoveOrphan={jest.fn()}
        onDeleteOrphan={jest.fn()}
        onInterpret={onInterpret}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Interpret/ }));
    expect(onInterpret).toHaveBeenCalledTimes(1);
  });
});
