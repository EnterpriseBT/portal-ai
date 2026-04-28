import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CreateStationDialog } =
  await import("../components/CreateStationDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("CreateStationDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render 'New Station' title", () => {
    render(<CreateStationDialog {...defaultProps} />);
    expect(screen.getByText("New Station")).toBeInTheDocument();
  });

  it("should render empty form fields", () => {
    render(<CreateStationDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Name/)).toHaveValue("");
    expect(screen.getByLabelText(/Description/)).toHaveValue("");
  });

  it("should show name required error when submitting empty name", async () => {
    render(<CreateStationDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("should submit with correct payload including default tool pack", async () => {
    const onSubmit = jest.fn();
    render(<CreateStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "My Station" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "My Station",
        toolPacks: ["data_query"],
      });
    });
  });

  it("should submit with name, description, and default tool pack", async () => {
    const onSubmit = jest.fn();
    render(<CreateStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Sales Station" },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "For sales data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Sales Station",
        description: "For sales data",
        toolPacks: ["data_query"],
      });
    });
  });

  it("should show 'Data Query' as default selected tool pack", () => {
    render(<CreateStationDialog {...defaultProps} />);
    expect(screen.getByText("Data Query")).toBeInTheDocument();
  });

  it("should show 'Creating...' and disable buttons when pending", () => {
    render(<CreateStationDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should display server error message and code", () => {
    render(
      <CreateStationDialog
        {...defaultProps}
        serverError={{
          message: "A station with this name already exists",
          code: "STATION_DUPLICATE_NAME",
        }}
      />
    );
    expect(
      screen.getByText(/A station with this name already exists/)
    ).toBeInTheDocument();
    expect(screen.getByText(/STATION_DUPLICATE_NAME/)).toBeInTheDocument();
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<CreateStationDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should not render content when open is false", () => {
    render(<CreateStationDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("New Station")).not.toBeInTheDocument();
  });

  it("should submit form on Enter key press in text field", async () => {
    const onSubmit = jest.fn();
    render(<CreateStationDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Enter Station" },
    });
    fireEvent.submit(screen.getByLabelText(/Name/).closest("form")!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Enter Station",
        toolPacks: ["data_query"],
      });
    });
  });

  it("should show field error on blur", async () => {
    render(<CreateStationDialog {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    fireEvent.focus(nameField);
    fireEvent.blur(nameField);
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
  });

  it("should set aria-invalid on name field when validation fails", async () => {
    render(<CreateStationDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    fireEvent.focus(nameInput);
    fireEvent.blur(nameInput);
    await waitFor(() => {
      expect(nameInput).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("should have aria-required on required fields", () => {
    render(<CreateStationDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    expect(nameInput).toBeRequired();
  });

  it("should have role='alert' on FormAlert when server error is present", () => {
    render(
      <CreateStationDialog
        {...defaultProps}
        serverError={{ message: "Oops", code: "ERR" }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("should auto-link aria-describedby to helper text via MUI", async () => {
    render(<CreateStationDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/Name/);
    fireEvent.focus(nameInput);
    fireEvent.blur(nameInput);
    await waitFor(() => {
      expect(nameInput).toHaveAttribute("aria-describedby");
    });
  });
});
