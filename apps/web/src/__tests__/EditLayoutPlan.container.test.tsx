import { jest } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { LayoutPlan } from "@portalai/core/contracts";

// #1009: Edit layout used to throw while hydrating a plan whose region's
// sheet was deleted or renamed at the source. It now opens, lists the region
// with Move to sheet / Delete, and keeps the rest editable.

const region = (id: string, sheet: string): LayoutPlan["regions"][number] => ({
  id,
  sheet,
  bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
  targetEntityDefinitionId: "contacts",
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
  headerStrategyByAxis: {
    row: {
      kind: "row",
      locator: { kind: "row", sheet, row: 1 },
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
});

const editContext = {
  planId: "plan_1",
  plan: {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Sheet1", "Q3"],
      dimensions: { Sheet1: { rows: 2, cols: 2 }, Q3: { rows: 2, cols: 2 } },
      anchorCells: [],
    },
    regions: [region("kept", "Sheet1"), region("orphan", "Q3")],
    confidence: { overall: 0.9, perRegion: { kept: 0.9, orphan: 0.9 } },
  } as LayoutPlan,
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
};

const query = <T,>(data: T) => ({ data, isLoading: false, error: null });
const mutation = {
  mutateAsync: jest.fn(),
  mutate: jest.fn(),
  isPending: false,
  error: null,
  reset: jest.fn(),
};

jest.unstable_mockModule("@tanstack/react-router", () => ({
  useNavigate: () => jest.fn(),
}));
jest.unstable_mockModule("../utils/use-running-job-subscriptions.util", () => ({
  useRunningJobSubscriptions: () => undefined,
}));
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorInstanceLayoutPlans: {
      getEditContext: () => query(editContext),
      commit: () => mutation,
      patch: () => mutation,
    },
    connectorInstances: {
      get: () =>
        query({
          connectorInstance: {
            id: "ci_1",
            name: "Sheets connector",
            capabilities: { read: true, write: true, delete: true },
          },
        }),
      runningJobs: () => query({ runningJobs: [] }),
    },
    layoutPlans: { interpret: () => mutation },
    googleSheets: { sheetSlice: () => mutation },
    microsoftExcel: { sheetSlice: () => mutation },
    fileUploads: { sheetSlice: () => mutation },
  },
  queryKeys: {
    connectorInstances: { root: ["connectorInstances"] },
    connectorEntities: { root: ["connectorEntities"] },
    entityRecords: { root: ["entityRecords"] },
    fieldMappings: { root: ["fieldMappings"] },
    jobs: { root: ["jobs"] },
  },
}));

const { render, screen, fireEvent, within } =
  await import("@testing-library/react");
const { ThemeProvider } = await import("@portalai/core/ui");
const { EditLayoutPlanView } = await import("../views/EditLayoutPlan.view");

const renderPage = () =>
  render(
    <ThemeProvider defaultTheme="brand">
      <QueryClientProvider client={new QueryClient()}>
        <EditLayoutPlanView connectorInstanceId="ci_1" />
      </QueryClientProvider>
    </ThemeProvider>
  );

describe("EditLayoutPlanView (container) — a region whose sheet is missing", () => {
  it("opens, and lists the region whose sheet is gone", async () => {
    renderPage();
    const notice = await screen.findByRole("region", {
      name: "Regions whose sheet is missing",
    });
    expect(notice).toHaveTextContent(
      'A1:B2 (Contacts) was on sheet "Q3", which is no longer in the workbook.'
    );
  });

  it("deleting it clears the list", async () => {
    renderPage();
    const notice = await screen.findByRole("region", {
      name: "Regions whose sheet is missing",
    });
    fireEvent.click(
      within(notice).getByRole("button", { name: "Delete region A1:B2" })
    );
    expect(
      screen.queryByRole("region", { name: "Regions whose sheet is missing" })
    ).toBeNull();
  });

  it("moving it onto a sheet adds it to the editor and clears the list", async () => {
    renderPage();
    const notice = await screen.findByRole("region", {
      name: "Regions whose sheet is missing",
    });
    fireEvent.mouseDown(
      within(notice).getByRole("combobox", { name: "Move A1:B2 to sheet" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Sheet1" }));
    expect(
      screen.queryByRole("region", { name: "Regions whose sheet is missing" })
    ).toBeNull();
    // Both regions are now drafts on Sheet1, and the moved one is selected.
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Jump to region" })
    );
    const regions = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-disabled") !== "true");
    expect(regions.map((o) => o.getAttribute("data-value"))).toEqual([
      "kept",
      "orphan",
    ]);
    expect(regions[1]).toHaveAttribute("aria-selected", "true");
  });
});
