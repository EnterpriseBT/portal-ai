import { jest } from "@jest/globals";
import type { Station } from "@portalai/core/models";

/**
 * #674: the curated-view picker in the create and edit station dialogs. The
 * SDK is mocked so the view search returns a known set.
 */

const mockSearch = jest.fn(async () => ({
  curatedViews: [
    { id: "cv-1", label: "Q3 orders" },
    { id: "cv-2", label: "Active customers" },
  ],
  total: 2,
}));

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    toolpacks: {
      list: () => ({ data: { toolpacks: [] }, isLoading: false }),
    },
    connectorInstances: {
      list: () => ({
        data: {
          connectorInstances: [
            { id: "ci-1", name: "CRM" },
            { id: "ci-2", name: "Billing" },
          ],
          total: 2,
        },
        isLoading: false,
      }),
    },
    curatedViews: { search: () => ({ mutateAsync: mockSearch }) },
  },
  queryKeys: { toolpacks: { root: ["toolpacks"] } },
}));

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CreateStationDialog, NO_VIEWS_SELECTED_HINT } =
  await import("../components/CreateStationDialog.component");
const { EditStationDialog } =
  await import("../components/EditStationDialog.component");

const base = {
  open: true,
  onClose: jest.fn(),
  isPending: false,
  serverError: null,
};

async function pickView(label: string) {
  fireEvent.mouseDown(screen.getByLabelText("Views"));
  fireEvent.click(await screen.findByText(label));
}

describe("CreateStationDialog — views (#674)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends the picked views as curatedViewIds", async () => {
    const onSubmit = jest.fn();
    render(<CreateStationDialog {...base} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "S" },
    });
    await pickView("Active customers");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "S",
        toolPacks: ["data_query"],
        curatedViewIds: ["cv-2"],
      })
    );
  });

  it("shows the no-views hint until a view is picked, without blocking submit", async () => {
    const onSubmit = jest.fn();
    render(<CreateStationDialog {...base} onSubmit={onSubmit} />);
    expect(screen.getByText(NO_VIEWS_SELECTED_HINT)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "S" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "S",
        toolPacks: ["data_query"],
      })
    );

    await pickView("Q3 orders");
    expect(screen.queryByText(NO_VIEWS_SELECTED_HINT)).not.toBeInTheDocument();
  });
});

describe("EditStationDialog — views and readable seeding (#674)", () => {
  beforeEach(() => jest.clearAllMocks());

  const station = {
    id: "st-1",
    organizationId: "org-1",
    name: "Sales",
    description: null,
    enabledToolpacks: ["data_query"],
    created: 1,
    createdBy: "u",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    instances: [
      { connectorInstanceId: "ci-1", canRead: true },
      { connectorInstanceId: "ci-hidden", canRead: false },
    ],
    views: [
      {
        curatedViewId: "cv-9",
        curatedView: { label: "Seeded view" },
        canRead: true,
      },
      {
        curatedViewId: "cv-hidden",
        curatedView: { label: "Hidden view" },
        canRead: false,
      },
    ],
  } as unknown as Station & { enabledToolpacks: string[] };

  it("seeds both pickers from readable attachments only", async () => {
    render(
      <EditStationDialog {...base} station={station} onSubmit={jest.fn()} />
    );
    expect(await screen.findByText("Seeded view")).toBeInTheDocument();
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.queryByText("Hidden view")).not.toBeInTheDocument();
    expect(screen.queryByText("ci-hidden")).not.toBeInTheDocument();
  });

  it("sends the readable view set when it changes, leaving connectors out", async () => {
    const onSubmit = jest.fn();
    render(
      <EditStationDialog {...base} station={station} onSubmit={onSubmit} />
    );
    await screen.findByText("Seeded view");
    await pickView("Q3 orders");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        curatedViewIds: ["cv-9", "cv-1"],
      })
    );
  });

  it("makes no call when nothing changed (unreadable attachments don't count as a change)", async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(
      <EditStationDialog
        {...base}
        onClose={onClose}
        station={station}
        onSubmit={onSubmit}
      />
    );
    await screen.findByText("Seeded view");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
