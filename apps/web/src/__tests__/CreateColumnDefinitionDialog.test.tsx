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
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
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
      target: { value: "email" },
    });
    fireEvent.change(screen.getByLabelText(/^Label/), {
      target: { value: "Email Address" },
    });
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: "Primary email" },
    });
    fireEvent.change(screen.getByLabelText(/^Validation Pattern/), {
      target: { value: "^.+@.+$" },
    });
    fireEvent.change(screen.getByLabelText(/^Validation Message/), {
      target: { value: "Must be a valid email" },
    });
    fireEvent.change(screen.getByLabelText(/^Canonical Format/), {
      target: { value: "RFC5322" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        key: "email",
        label: "Email Address",
        type: "string",
        description: "Primary email",
        validationPattern: "^.+@.+$",
        validationMessage: "Must be a valid email",
        canonicalFormat: "RFC5322",
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
  it("should render new fields: Validation Pattern, Validation Message, Canonical Format", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Validation Pattern/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Validation Message/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Canonical Format/)).toBeInTheDocument();
  });

  // #22
  it("should NOT render removed fields: Required, Default Value, Format, Enum Values", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.queryByLabelText(/^Required/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Default Value/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Format$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Enum Values/)).not.toBeInTheDocument();
  });

  // #23
  it("should not include 'currency' in type select options", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByLabelText(/^Type/));
    expect(screen.queryByRole("option", { name: "currency" })).not.toBeInTheDocument();
  });

  // #24
  it("should render Validation Preset dropdown", () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Validation Preset/)).toBeInTheDocument();
  });

  // #25
  it("should auto-populate validation fields when Email preset is selected", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByLabelText(/^Validation Preset/));
    fireEvent.click(screen.getByRole("option", { name: "Email" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
      expect(screen.getByLabelText(/^Validation Message/)).toHaveValue("Must be a valid email address");
    });
  });

  // #26
  it("should auto-populate validation fields when URL preset is selected", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByLabelText(/^Validation Preset/));
    fireEvent.click(screen.getByRole("option", { name: "URL" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^https?://.*");
      expect(screen.getByLabelText(/^Validation Message/)).toHaveValue("Must be a valid URL");
    });
  });

  // #27
  it("should auto-populate validation fields when UUID preset is selected", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByLabelText(/^Validation Preset/));
    fireEvent.click(screen.getByRole("option", { name: "UUID" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
      expect(screen.getByLabelText(/^Validation Message/)).toHaveValue("Must be a valid UUID");
    });
  });

  // #28
  it("should allow manual editing of validation fields after preset selection", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    // Select a preset
    fireEvent.mouseDown(screen.getByLabelText(/^Validation Preset/));
    fireEvent.click(screen.getByRole("option", { name: "Email" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    });
    // Manually override
    fireEvent.change(screen.getByLabelText(/^Validation Pattern/), {
      target: { value: "^custom@.*$" },
    });
    expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^custom@.*$");
  });

  // #29
  it("should clear validation fields when None preset is selected", async () => {
    render(<CreateColumnDefinitionDialog {...defaultProps} />);
    // Select Email first
    fireEvent.mouseDown(screen.getByLabelText(/^Validation Preset/));
    fireEvent.click(screen.getByRole("option", { name: "Email" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    });
    // Select None — use getAllByLabelText since MUI may render multiple matching nodes when listbox is open
    fireEvent.mouseDown(screen.getAllByLabelText(/^Validation Preset/)[0]);
    fireEvent.click(screen.getByRole("option", { name: "None" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("");
      expect(screen.getByLabelText(/^Validation Message/)).toHaveValue("");
    });
  });
});
