import { jest } from "@jest/globals";
import type { ColumnDefinition } from "@portalai/core/models";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { EditColumnDefinitionDialog } = await import(
  "../components/EditColumnDefinitionDialog.component"
);

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
    expect(screen.queryByText("Edit Column Definition")).not.toBeInTheDocument();
  });

  it("should pre-fill form with column definition values", () => {
    const cd = makeColumnDefinition({
      label: "Email",
      type: "string",
      description: "Primary email",
      validationPattern: "^.+@.+$",
      validationMessage: "Must be valid",
      canonicalFormat: "RFC5322",
    });
    render(<EditColumnDefinitionDialog {...defaultProps} columnDefinition={cd} />);
    expect(screen.getByLabelText(/^Label/)).toHaveValue("Email");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Primary email");
    expect(screen.getByLabelText(/^Validation Pattern/)).toHaveValue("^.+@.+$");
    expect(screen.getByLabelText(/^Validation Message/)).toHaveValue("Must be valid");
    expect(screen.getByLabelText(/^Canonical Format/)).toHaveValue("RFC5322");
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
    expect(screen.queryByRole("option", { name: "currency" })).not.toBeInTheDocument();
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
    render(<EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />);
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
    render(<EditColumnDefinitionDialog {...defaultProps} onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // ── Revalidation confirmation ──────────────────────────────────────

  it("should show revalidation warning when validationPattern is changed", async () => {
    const onSubmit = jest.fn();
    render(<EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />);
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
    render(<EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^Canonical Format/), {
      target: { value: "RFC5322" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should NOT show revalidation warning when only label is changed", async () => {
    const onSubmit = jest.fn();
    render(<EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />);
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
    render(<EditColumnDefinitionDialog {...defaultProps} onSubmit={onSubmit} />);
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
      expect(screen.getByLabelText(/^Label/)).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("should have required attribute on label field", () => {
    render(<EditColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByLabelText(/^Label/)).toBeRequired();
  });
});
