import { jest } from "@jest/globals";
import type { ColumnDefinition } from "@portalai/core/models";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { EditColumnDefinitionDialog } =
  await import("../components/EditColumnDefinitionDialog.component");

const makeColumnDefinition = (
  overrides: Partial<ColumnDefinition> = {}
): ColumnDefinition => ({
  id: "cd-1",
  organizationId: "org-1",
  key: "first_name",
  label: "First Name",
  type: "string",
  description: null,
  validationPattern: null,
  validationMessage: null,
  canonicalFormat: null,
  system: false,
  created: 1735689600000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  columnDefinition: makeColumnDefinition(),
  isPending: false,
  serverError: null,
  warnings: [] as string[],
};

describe("EditColumnDefinitionDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────

  it("should render 'Edit Column Definition' title when open", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByText("Edit Column Definition")).toBeInTheDocument();
  });

  it("should not render when open is false", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("Edit Column Definition")
    ).not.toBeInTheDocument();
  });

  it("should pre-fill form with column definition values", () => {
    const cd = makeColumnDefinition({
      label: "Email",
      type: "string",
      description: "Primary email",
      validationPattern: "^.+@.+$",
      validationMessage: "Must be valid",
      canonicalFormat: "lowercase",
    });
    render(
      <EditColumnDefinitionDialog {...defaultProps} columnDefinition={cd} />
    );
    expect(screen.getByLabelText(/^Label/)).toHaveValue("Email");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Primary email");
    expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^.+@.+$");
    expect(screen.getByLabelText(/^Validation Message/)).toHaveValue(
      "Must be valid"
    );
    // Canonical Format is a Select — check the displayed text content
    expect(screen.getByLabelText(/^Canonical Format/)).toHaveTextContent(
      /Lowercase/
    );
  });

  it("should show Key as a disabled field", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByDisplayValue("first_name")).toBeDisabled();
  });

  it("should render Validation Pattern, Validation Message, Canonical Format fields", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Validation Pattern/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Validation Message/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Canonical Format/)).toBeInTheDocument();
  });

  it("should NOT render Required, Default Value, Format, Enum Values fields", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.queryByLabelText(/^Required/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Default Value/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Format$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Enum Values/)).not.toBeInTheDocument();
  });

  it("should not include 'currency' in type select options", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByLabelText(/^Type/));
    expect(
      screen.queryByRole("option", { name: "currency" })
    ).not.toBeInTheDocument();
  });

  it("should disable types not in ALLOWED_TYPE_TRANSITIONS", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByLabelText(/^Type/));
    // string -> enum is allowed
    const enumOption = screen.getByRole("option", { name: /enum/ });
    expect(enumOption).not.toHaveAttribute("aria-disabled", "true");
    // string -> number is not allowed
    const numberOption = screen.getByRole("option", { name: /^number/ });
    expect(numberOption).toHaveAttribute("aria-disabled", "true");
  });

  // ── Submit payload ─────────────────────────────────────────────────

  it("should submit only changed fields", async () => {
    const onSubmit = jest.fn();
    render(
      <EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Label/), {
      target: { value: "Updated Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ label: "Updated Name" });
    });
  });

  it("should call onClose without onSubmit when no changes are made", async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <EditColumnDefinitionDialog
        {...defaultProps}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ── Revalidation confirmation ──────────────────────────────────────

  it("should show revalidation warning when validationPattern is changed", async () => {
    const onSubmit = jest.fn();
    render(
      <EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Validation Pattern/), {
      target: { value: "^.+@.+$" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should show revalidation warning when canonicalFormat is changed", async () => {
    const onSubmit = jest.fn();
    render(
      <EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    // Canonical Format is a Select dropdown
    fireEvent.mouseDown(screen.getByLabelText(/^Canonical Format/));
    fireEvent.click(screen.getByRole("option", { name: /Lowercase/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should NOT show revalidation warning when only label is changed", async () => {
    const onSubmit = jest.fn();
    render(
      <EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Label/), {
      target: { value: "New Label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ label: "New Label" });
    });
    expect(screen.queryByText(/trigger re-validation/)).not.toBeInTheDocument();
  });

  it("should call onSubmit when Confirm & Save is clicked after revalidation warning", async () => {
    const onSubmit = jest.fn();
    render(
      <EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Validation Pattern/), {
      target: { value: "^test$" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ validationPattern: "^test$" });
    });
  });

  // ── Standard dialog behavior ───────────────────────────────────────

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<EditColumnDefinitionDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should show 'Saving...' and disable buttons when isPending", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <EditColumnDefinitionDialog
        {...defaultProps}
        serverError={{ message: "Duplicate key", code: "CD_DUPLICATE" }}
      />
    );
    expect(screen.getByText(/Duplicate key/)).toBeInTheDocument();
    expect(screen.getByText(/CD_DUPLICATE/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("should show warnings when warnings array is non-empty", () => {
    render(
      <EditColumnDefinitionDialog
        {...defaultProps}
        warnings={["Enum value 'foo' removed from 3 records"]}
      />
    );
    expect(screen.getByText(/Enum value 'foo' removed/)).toBeInTheDocument();
  });

  it("should submit form on Enter key press", async () => {
    const onClose = jest.fn();
    render(<EditColumnDefinitionDialog {...defaultProps} onClose={onClose} />);
    // No changes — form submit should call onClose
    fireEvent.submit(screen.getByDisplayValue("first_name").closest("form")!);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("should set aria-invalid on label field when validation fails", async () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/^Label/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Label/)).toHaveAttribute(
        "aria-invalid",
        "true"
      );
    });
  });

  it("should have required attribute on label field", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Label/)).toBeRequired();
  });

  // ── Type-aware field behavior ───────────────────────────────────────

  it("should disable validation fields when type does not support validation", () => {
    const cd = makeColumnDefinition({ type: "boolean" });
    render(
      <EditColumnDefinitionDialog {...defaultProps} columnDefinition={cd} />
    );
    expect(screen.getByLabelText(/^Validation Preset/)).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByLabelText(/^Validation Pattern/)).toBeDisabled();
    expect(screen.getByLabelText(/^Validation Message/)).toBeDisabled();
  });

  it("should disable canonical format when type does not support it", () => {
    const cd = makeColumnDefinition({ type: "boolean" });
    render(
      <EditColumnDefinitionDialog {...defaultProps} columnDefinition={cd} />
    );
    expect(screen.getByLabelText(/^Canonical Format/)).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("should show 'Not applicable' helper text for disabled fields", () => {
    const cd = makeColumnDefinition({ type: "boolean" });
    render(
      <EditColumnDefinitionDialog {...defaultProps} columnDefinition={cd} />
    );
    expect(
      screen.getAllByText(/Not applicable for this column type/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("should show error for invalid regex in validation pattern", async () => {
    const onSubmit = jest.fn();
    render(
      <EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />
    );
    fireEvent.change(screen.getByLabelText(/^Validation Pattern/), {
      target: { value: "[invalid(" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        screen.getByText("Invalid regular expression")
      ).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should set aria-invalid on validation pattern field for invalid regex", async () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/^Validation Pattern/), {
      target: { value: "[invalid(" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveAttribute(
        "aria-invalid",
        "true"
      );
    });
  });

  it("should render Validation Preset dropdown", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Validation Preset/)).toBeInTheDocument();
  });

  it("should auto-populate validation fields when preset is selected", async () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    fireEvent.mouseDown(screen.getByLabelText(/^Validation Preset/));
    fireEvent.click(screen.getByRole("option", { name: "Email" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue(
        "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
      );
      expect(screen.getByLabelText(/^Validation Message/)).toHaveValue(
        "Must be a valid email address"
      );
    });
  });
});
