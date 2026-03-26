import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");

// Mock the sdk modules to avoid real API calls in the dialog
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: {
      current: () => ({
        data: {
          organization: {
            id: "org-1",
            name: "Test Org",
            timezone: "UTC",
            ownerUserId: "user-1",
            defaultStationId: "station-default",
            created: 1710000000000,
            createdBy: "user-1",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
        },
        error: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
      }),
    },
    stations: {
      list: () => ({
        data: {
          stations: [
            {
              id: "station-default",
              organizationId: "org-1",
              name: "Default Station",
              toolPacks: ["data_query"],
              created: 1710000000000,
              createdBy: "user-1",
              updated: null,
              updatedBy: null,
              deleted: null,
              deletedBy: null,
            },
            {
              id: "station-2",
              organizationId: "org-1",
              name: "Other Station",
              toolPacks: ["data_query"],
              created: 1710000000000,
              createdBy: "user-1",
              updated: null,
              updatedBy: null,
              deleted: null,
              deletedBy: null,
            },
          ],
          total: 2,
          limit: 100,
          offset: 0,
        },
        error: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
      }),
    },
  },
  queryKeys: {
    portals: { root: ["portals"] },
    stations: { root: ["stations"] },
    organizations: { root: ["organizations"] },
  },
}));

// Re-import after mocking
const { CreatePortalDialog: MockedCreatePortalDialog } = await import(
  "../components/CreatePortalDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("CreatePortalDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render 'New Portal' title", () => {
    render(<MockedCreatePortalDialog {...defaultProps} />);
    expect(screen.getByText("New Portal")).toBeInTheDocument();
  });

  it("should render station select field", () => {
    render(<MockedCreatePortalDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Station/)).toBeInTheDocument();
  });

  it("should show 'Creating...' and disable buttons when pending", () => {
    render(<MockedCreatePortalDialog {...defaultProps} isPending={true} />);
    expect(
      screen.getByRole("button", { name: "Creating..." })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should display server error message", () => {
    render(
      <MockedCreatePortalDialog
        {...defaultProps}
        serverError="Failed to create portal"
      />
    );
    expect(
      screen.getByText("Failed to create portal")
    ).toBeInTheDocument();
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<MockedCreatePortalDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should not render content when open is false", () => {
    render(<MockedCreatePortalDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("New Portal")).not.toBeInTheDocument();
  });
});
