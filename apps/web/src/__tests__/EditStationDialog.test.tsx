import { jest } from "@jest/globals";
import type { Station } from "@portalai/core/models";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { EditStationDialog } =
  await import("../components/EditStationDialog.component");

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
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("EditStationDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render 'Edit Station' title", () => {
    render(<EditStationDialog {...defaultProps} />);
    expect(screen.getByText("Edit Station")).toBeInTheDocument();
  });

  it("should pre-populate the name field with station name", () => {
    render(<EditStationDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Name/)).toHaveValue("Sales Analytics");
  });

  it("should pre-populate tool packs from station", () => {
    render(<EditStationDialog {...defaultProps} />);
    expect(screen.getByText("Data Query")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
  });

  it("should show name required error when name is cleared and submitted", async () => {
    render(<EditStationDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("should submit only changed fields when name is updated", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Updated Station" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: "Updated Station" });
    });
  });

  it("should call onClose without submitting when nothing changed", () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <EditStationDialog
        {...defaultProps}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should show 'Saving...' and disable buttons when pending", () => {
    render(<EditStationDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should display server error message and code", () => {
    render(
      <EditStationDialog
        {...defaultProps}
        serverError={{
          message: "Station name already exists",
          code: "STATION_DUPLICATE_NAME",
        }}
      />
    );
    expect(screen.getByText(/Station name already exists/)).toBeInTheDocument();
    expect(screen.getByText(/STATION_DUPLICATE_NAME/)).toBeInTheDocument();
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<EditStationDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should not render content when open is false", () => {
    render(<EditStationDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Edit Station")).not.toBeInTheDocument();
  });

  it("should submit form on Enter key press in text field", async () => {
    const onSubmit = jest.fn();
    render(<EditStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Updated Station" },
    });
    fireEvent.submit(screen.getByLabelText(/Name/).closest("form")!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: "Updated Station" });
    });
  });

  it("should show field error on blur when name is empty", async () => {
    render(<EditStationDialog {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    fireEvent.change(nameField, { target: { value: "" } });
    fireEvent.blur(nameField);
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
  });

  it("should set aria-invalid on name field when validation fails", async () => {
    render(<EditStationDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    fireEvent.change(nameInput, { target: { value: "" } });
    fireEvent.blur(nameInput);
    await waitFor(() => {
      expect(nameInput).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("should have aria-required on required fields", () => {
    render(<EditStationDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    expect(nameInput).toBeRequired();
  });
});
