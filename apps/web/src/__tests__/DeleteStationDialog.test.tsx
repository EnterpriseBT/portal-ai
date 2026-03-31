import { jest } from "@jest/globals";
import type { Station } from "@portalai/core/models";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteStationDialog } = await import(
  "../components/DeleteStationDialog.component"
);

const sampleStation: Station = {
  id: "station-1",
  organizationId: "org-1",
  name: "Sales Analytics",
  description: "Sales data analysis station",
  toolPacks: ["data_query", "statistics"],
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  station: sampleStation,
  onConfirm: jest.fn(),
  isPending: false,
};

describe("DeleteStationDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render 'Delete Station' title", () => {
    render(<DeleteStationDialog {...defaultProps} />);
    expect(screen.getByText("Delete Station")).toBeInTheDocument();
  });

  it("should display station name in the confirmation message", () => {
    render(<DeleteStationDialog {...defaultProps} />);
    expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
  });

  it("should display the cascade warning about portals and unpinned results", () => {
    render(<DeleteStationDialog {...defaultProps} />);
    expect(
      screen.getByText(/All associated portals, their messages, and unpinned results/)
    ).toBeInTheDocument();
  });

  it("should mention that pinned results will be preserved", () => {
    render(<DeleteStationDialog {...defaultProps} />);
    expect(
      screen.getByText(/Pinned results will be preserved/)
    ).toBeInTheDocument();
  });

  it("should call onConfirm when Delete is clicked", () => {
    const onConfirm = jest.fn();
    render(<DeleteStationDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should submit on Enter key press (form submission)", () => {
    const onConfirm = jest.fn();
    render(<DeleteStationDialog {...defaultProps} onConfirm={onConfirm} />);
    const form = screen.getByRole("button", { name: "Delete" }).closest("form")!;
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<DeleteStationDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should show 'Deleting...' and disable buttons when pending", () => {
    render(<DeleteStationDialog {...defaultProps} isPending={true} />);
    expect(
      screen.getByRole("button", { name: "Deleting..." })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should not render content when open is false", () => {
    render(<DeleteStationDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete Station")).not.toBeInTheDocument();
  });

  it("should handle null station gracefully", () => {
    render(<DeleteStationDialog {...defaultProps} station={null} />);
    expect(screen.getByText("Delete Station")).toBeInTheDocument();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeleteStationDialog
        {...defaultProps}
        serverError={{ message: "Station not found", code: "STATION_NOT_FOUND" }}
      />
    );
    expect(screen.getByText(/Station not found/)).toBeInTheDocument();
    expect(screen.getByText(/STATION_NOT_FOUND/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(<DeleteStationDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
