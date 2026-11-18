import { jest } from "@jest/globals";

/**
 * #674: the station detail page shows both attachment kinds as chips (locked
 * where the viewer can't read) and the single station-level alert.
 */

const result = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isSuccess: true,
  error: null,
});
const mutation = () => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  error: null,
});

// #789: the edit dialog's mutation carries the last attempt's failure, and
// closing the dialog must reset it so a reopened dialog starts clean.
const mockUpdateReset = jest.fn();
const failedUpdate = () => ({
  ...mutation(),
  reset: mockUpdateReset,
  error: { message: "That name is taken", code: "STATION_CONFLICT" },
});

const mockStationsGet = jest.fn();
// #1055: the plan the page reads; `undefined` fails open (everything entitled).
let mockUsageData: unknown = undefined;
// #1041: the delete's refresh list, read off the call.
const mockDeleteMutate = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: {
      get: mockStationsGet,
      update: failedUpdate,
      delete: () => ({ ...mutation(), mutate: mockDeleteMutate }),
    },
    portals: {
      list: () => result({ portals: [], total: 0, limit: 10, offset: 0 }),
      create: mutation,
      remove: mutation,
    },
    organizations: {
      current: () => result({ organization: { defaultStationId: null } }),
      usage: () => result(mockUsageData),
    },
    toolpacks: { list: () => result({ toolpacks: [] }) },
    // The edit dialog's connector picker (#789's reset test opens it).
    connectorInstances: {
      list: () => result({ connectorInstances: [], total: 0 }),
    },
    // The (closed) ShareDialog's queries.
    members: { list: () => result({ members: [] }) },
    grants: {
      list: () => result({ grants: [] }),
      share: mutation,
      revoke: mutation,
    },
    curatedViews: {
      list: () => result({ curatedViews: [], total: 0 }),
      search: mutation,
    },
  },
  queryKeys: {
    stations: { root: ["stations"] },
    portals: { root: ["portals"] },
    curatedViews: { root: ["curatedViews"] },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { StationDetailView } = await import("../views/StationDetail.view");

const base = {
  id: "st-1",
  organizationId: "org-1",
  name: "Sales",
  description: null,
  enabledToolpacks: ["data_query"],
  created: Date.now(),
  createdBy: "u",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const payload = (instances: unknown[], views: unknown[]) =>
  result({
    station: {
      ...base,
      instances,
      views,
      // #688: the caller's capabilities ride on the row.
      capabilities: { read: true, write: false, delete: false, share: false },
    },
  });

const instance = (id: string, name: string, canRead: boolean) => ({
  id: `si-${id}`,
  stationId: "st-1",
  connectorInstanceId: id,
  connectorInstance: { id, name },
  canRead,
});
const view = (id: string, label: string, canRead: boolean) => ({
  id: `sv-${id}`,
  stationId: "st-1",
  curatedViewId: id,
  curatedView: { id, key: id, label },
  canRead,
});

describe("StationDetailView — attachments (#674)", () => {
  beforeEach(() => mockStationsGet.mockReset());

  it("fetches both attachment kinds", () => {
    mockStationsGet.mockReturnValue(payload([], []));
    render(<StationDetailView stationId="st-1" />);
    expect(mockStationsGet).toHaveBeenCalledWith("st-1", {
      include: "connectorInstance,curatedView",
    });
  });

  it("renders Views and Connectors rows, locking what the viewer can't read", () => {
    mockStationsGet.mockReturnValue(
      payload(
        [instance("ci-1", "CRM", true), instance("ci-2", "HR system", false)],
        [view("cv-1", "Q3 orders", true), view("cv-2", "Payroll", false)]
      )
    );
    render(<StationDetailView stationId="st-1" />);
    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(screen.getByText("Connectors")).toBeInTheDocument();
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.getByText("Q3 orders")).toBeInTheDocument();
    const locked = screen.getAllByTestId("attachment-chip-no-access");
    expect(locked.map((c) => c.textContent)).toEqual(["HR system", "Payroll"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows one combined alert and — in both rows when nothing is attached", () => {
    mockStationsGet.mockReturnValue(payload([], []));
    render(<StationDetailView stationId="st-1" />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(
      "No views or connectors are attached to this station. It works without them. Attach a view to query entity data here, or a connector to create and edit entities."
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(
      screen.queryByText(/This station has no connector instances/)
    ).not.toBeInTheDocument();
  });

  it("names only the missing kind", () => {
    mockStationsGet.mockReturnValue(
      payload([instance("ci-1", "CRM", true)], [])
    );
    render(<StationDetailView stationId="st-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No views are attached to this station. Attach a view to query entity data here."
    );
  });

  // #1055: the repro. The station's only pack that reads data is GIS, and
  // the plan excludes it, so the plan is the reason, not a missing view.
  it("names the plan-excluded pack instead of suggesting a view", () => {
    mockUsageData = {
      tier: {
        tier: "standard",
        entitlements: {
          builtinToolpacks: ["data_query", "view_management"],
          customToolpacks: false,
        },
      },
      usage: { periodId: "2026-11", byClass: {} },
    };
    mockStationsGet.mockReturnValue(
      result({
        station: {
          ...base,
          enabledToolpacks: ["gis", "view_management"],
          instances: [instance("ci-1", "CRM", true)],
          views: [],
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
        },
      })
    );
    try {
      render(<StationDetailView stationId="st-1" />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(
        "GIS isn't included in your plan, so attaching a view won't make data available on this station."
      );
      expect(alert).not.toHaveTextContent(/Attach a view/);
    } finally {
      mockUsageData = undefined;
    }
  });
});

// #1063: a member can't list the org's packs (the list mock answers none),
// so the station read's names are what the chips show.
describe("StationDetailView — custom pack names (#1063)", () => {
  it("names a custom pack from the station read", () => {
    mockStationsGet.mockReturnValue(
      result({
        station: {
          ...base,
          enabledToolpacks: ["data_query", "org:tp-1"],
          toolpacks: [
            { ref: "data_query", kind: "builtin", name: "Data Query" },
            { ref: "org:tp-1", kind: "custom", name: "Acme CRM" },
          ],
          instances: [],
          views: [],
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
        },
      })
    );
    render(<StationDetailView stationId="st-1" />);
    expect(screen.getByText("Acme CRM")).toBeInTheDocument();
    expect(screen.queryByText("org:tp-1")).not.toBeInTheDocument();
  });
});

describe("StationDetailView — a failed edit doesn't follow the dialog (#789)", () => {
  beforeEach(() => {
    mockStationsGet.mockReset();
    mockUpdateReset.mockReset();
  });

  it("resets the update when the edit dialog closes", async () => {
    const user = userEvent.setup();
    const writable = payload([], []) as { data: { station: object } };
    writable.data.station = {
      ...writable.data.station,
      capabilities: { read: true, write: true, delete: false, share: false },
    };
    mockStationsGet.mockReturnValue(writable);
    render(<StationDetailView stationId="st-1" />);
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /edit/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That name is taken"
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockUpdateReset).toHaveBeenCalledTimes(1);
  });
});

// #1041: deleting the default station from its own page left the cached org
// pointing at it, and the Stations page showed "Station not found". The
// delete must refresh the organization along with what cascades.
describe("StationDetailView — delete refreshes the organization (#1041)", () => {
  beforeEach(() => {
    mockStationsGet.mockReset();
    mockDeleteMutate.mockReset();
  });

  it("passes the organization among the keys the delete invalidates", async () => {
    mockStationsGet.mockReturnValue(
      result({
        station: {
          ...base,
          instances: [],
          views: [],
          capabilities: { read: true, write: true, delete: true, share: true },
        },
      })
    );
    const user = userEvent.setup();
    render(<StationDetailView stationId="st-1" />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    const { within } = await import("@testing-library/react");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
    const [, options] = mockDeleteMutate.mock.calls[0] as [
      unknown,
      { invalidate: unknown[] },
    ];
    expect(options.invalidate).toEqual(
      expect.arrayContaining([
        ["stations"],
        ["portals"],
        ["portalResults"],
        ["organizations"],
      ])
    );
  });
});
