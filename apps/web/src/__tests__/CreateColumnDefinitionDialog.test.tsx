import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CreateColumnDefinitionDialog } = await import(
  "../components/CreateColumnDefinitionDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("CreateColumnDefinitionDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // #1
  it("should render 'New Column Definition' title", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByText("New Column Definition")).toBeInTheDocument();
  });

  // #2
  it("should render empty form fields with defaults", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Key/)).toHaveValue("");
    expect(screen.getByLabelText(/^Label/)).toHaveValue("");
    expect(screen.getByLabelText(/^Type/)).toHaveTextContent("string");
  });

  // #3
  it("should not render content when open is false", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("New Column Definition")
    ).not.toBeInTheDocument();
  });

  // #4
  it("should show key validation error when submitting empty key", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(
        screen.getByText(/Key must be lowercase alphanumeric/)
      ).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // #5
  it("should show key format error for invalid key", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/^Key/), {
      target: { value: "Bad Key!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(
        screen.getByText(/Key must be lowercase alphanumeric/)
      ).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // #6
  it("should show label required error when submitting empty label", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/^Key/), {
      target: { value: "valid_key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Label is required")).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // #7
  it("should submit with correct payload for minimal valid form", async () => {
    const onSubmit = jest.fn();
    render(
      <CreateColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Key/), {
      target: { value: "customer_name" },
    });
    fireEvent.change(screen.getByLabelText(/^Label/), {
      target: { value: "Customer Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        key: "customer_name",
        label: "Customer Name",
        type: "string",
        required: false,
        defaultValue: null,
        format: null,
        description: null,
        enumValues: null,
      });
    });
  });

  // #8
  it("should submit with all optional fields populated", async () => {
    const onSubmit = jest.fn();
    render(
      <CreateColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Key/), {
      target: { value: "status" },
    });
    fireEvent.change(screen.getByLabelText(/^Label/), {
      target: { value: "Status" },
    });
    // Change type to enum
    fireEvent.mouseDown(screen.getByLabelText(/^Type/));
    fireEvent.click(screen.getByRole("option", { name: "enum" }));
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: "Current status" },
    });
    fireEvent.click(screen.getByLabelText(/^Required/));
    fireEvent.change(screen.getByLabelText(/^Default Value/), {
      target: { value: "active" },
    });
    fireEvent.change(screen.getByLabelText(/^Format/), {
      target: { value: "lowercase" },
    });
    fireEvent.change(screen.getByLabelText(/^Enum Values/), {
      target: { value: "active, inactive, pending" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        key: "status",
        label: "Status",
        type: "enum",
        required: true,
        defaultValue: "active",
        format: "lowercase",
        description: "Current status",
        enumValues: ["active", "inactive", "pending"],
      });
    });
  });

  // #9
  it("should submit form on Enter key press (form submission)", async () => {
    const onSubmit = jest.fn();
    render(
      <CreateColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Key/), {
      target: { value: "test_key" },
    });
    fireEvent.change(screen.getByLabelText(/^Label/), {
      target: { value: "Test" },
    });
    fireEvent.submit(screen.getByLabelText(/^Key/).closest("form")!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  // #10
  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(
      <CreateColumnDefinitionDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  // #11
  it("should show 'Creating...' and disable buttons when pending", () => {
    render(
      <CreateColumnDefinitionDialog {...defaultProps} isPending={true} />
    );
    expect(
      screen.getByRole("button", { name: "Creating..." })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  // #12
  it("should display server error message and code via FormAlert", () => {
    render(
      <CreateColumnDefinitionDialog
        {...defaultProps}
        serverError={{
          message: "Duplicate key",
          code: "COLUMN_DEFINITION_DUPLICATE_KEY",
        }}
      />
    );
    expect(screen.getByText(/Duplicate key/)).toBeInTheDocument();
    expect(
      screen.getByText(/COLUMN_DEFINITION_DUPLICATE_KEY/)
    ).toBeInTheDocument();
  });

  // #13
  it("should not render FormAlert when serverError is null", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // #14
  it("should have role='alert' on FormAlert when server error is present", () => {
    render(
      <CreateColumnDefinitionDialog
        {...defaultProps}
        serverError={{ message: "Oops", code: "ERR" }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  // #15
  it("should show field error on blur for key field", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    const keyField = screen.getByLabelText(/^Key/);
    fireEvent.focus(keyField);
    fireEvent.blur(keyField);
    await waitFor(() => {
      expect(
        screen.getByText(/Key must be lowercase alphanumeric/)
      ).toBeInTheDocument();
    });
  });

  // #16
  it("should show field error on blur for label field", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    const labelField = screen.getByLabelText(/^Label/);
    fireEvent.focus(labelField);
    fireEvent.blur(labelField);
    await waitFor(() => {
      expect(screen.getByText("Label is required")).toBeInTheDocument();
    });
  });

  // #17
  it("should set aria-invalid on key field when validation fails", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Key/)).toHaveAttribute(
        "aria-invalid",
        "true"
      );
    });
  });

  // #18
  it("should set aria-invalid on label field when validation fails", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Label/)).toHaveAttribute(
        "aria-invalid",
        "true"
      );
    });
  });

  // #19
  it("should have required attribute on key and label fields", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Key/)).toBeRequired();
    expect(screen.getByLabelText(/^Label/)).toBeRequired();
  });

  // #20
  it("should auto-link aria-describedby to helper text via MUI", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    const keyInput = screen.getByLabelText(/^Key/);
    // Key field always has helper text ("e.g. customer_name"), so aria-describedby should be set
    expect(keyInput).toHaveAttribute("aria-describedby");
  });

  // #21
  it("should show enum values field only when type is 'enum'", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.queryByLabelText(/^Enum Values/)).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText(/^Type/));
    fireEvent.click(screen.getByRole("option", { name: "enum" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Enum Values/)).toBeInTheDocument();
    });
  });

  // #22
  it("should hide enum values field when type changes away from 'enum'", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    // Select enum
    fireEvent.mouseDown(screen.getByLabelText(/^Type/));
    fireEvent.click(screen.getByRole("option", { name: "enum" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Enum Values/)).toBeInTheDocument();
    });
    // Change back to number (avoids "string" matching the already-selected value)
    fireEvent.mouseDown(screen.getAllByLabelText(/^Type/)[0]);
    fireEvent.click(screen.getByRole("option", { name: "number" }));
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/^Enum Values/)
      ).not.toBeInTheDocument();
    });
  });
});
