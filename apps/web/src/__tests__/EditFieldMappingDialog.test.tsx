import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { EditFieldMappingDialog } =
  await import("../components/EditFieldMappingDialog.component");

const defaultFieldMapping = {
  sourceField: "user_email",
  normalizedKey: "email",
  isPrimaryKey: false,
  required: true,
  defaultValue: null as string | null,
  format: null as string | null,
  enumValues: null as string[] | null,
  columnDefinitionId: "cd-1",
  columnDefinitionLabel: "Email Address",
  connectorEntityLabel: "Contacts",
  refNormalizedKey: null,
  refEntityKey: null,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  fieldMapping: defaultFieldMapping,
  onSearchConnectorEntitiesForRefKey: jest
    .fn<(q: string) => Promise<{ value: string; label: string }[]>>()
    .mockResolvedValue([]),
  isPending: false,
  serverError: null,
  columnDefinitionType: "string",
};

describe("EditFieldMappingDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────

  it("should render title when open", () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    expect(screen.getByText("Edit Field Mapping")).toBeInTheDocument();
  });

  it("should not render when open is false", () => {
    render(<EditFieldMappingDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Edit Field Mapping")).not.toBeInTheDocument();
  });

  it("should pre-fill form with field mapping values", () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Source Field/)).toHaveValue("user_email");
    expect(screen.getByLabelText(/Normalized Key/)).toHaveValue("email");
  });

  it("should render Normalized Key, Required, Default Value, Format fields", () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Normalized Key/)).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByLabelText(/Default Value/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Format/)).toBeInTheDocument();
  });

  it("should show Enum Values only when column type is enum", () => {
    render(
      <EditFieldMappingDialog {...defaultProps} columnDefinitionType="string" />
    );
    expect(screen.queryByLabelText(/Enum Values/)).not.toBeInTheDocument();
  });

  it("should render Enum Values when column type is enum", () => {
    render(
      <EditFieldMappingDialog
        {...defaultProps}
        columnDefinitionType="enum"
        fieldMapping={{ ...defaultFieldMapping, enumValues: ["a", "b"] }}
      />
    );
    expect(screen.getByLabelText(/Enum Values/)).toHaveValue("a, b");
  });

  it("should show Column Definition and Connector Entity as disabled fields", () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    expect(screen.getByDisplayValue("Email Address")).toBeDisabled();
    expect(screen.getByDisplayValue("Contacts")).toBeDisabled();
  });

  // ── Normalized Key validation ──────────────────────────────────────

  it("should show error for invalid normalizedKey format", async () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Normalized Key/), {
      target: { value: "Bad Key!" },
    });
    fireEvent.blur(screen.getByLabelText(/Normalized Key/));
    await waitFor(() => {
      expect(
        screen.getByText(/Must be lowercase alphanumeric/)
      ).toBeInTheDocument();
    });
  });

  it("should show error for empty normalizedKey on submit", async () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Normalized Key/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Normalized Key/)).toHaveAttribute(
        "aria-invalid",
        "true"
      );
    });
  });

  // ── Submit payload ─────────────────────────────────────────────────

  it("should include new fields in submit payload", async () => {
    const onSubmit = jest.fn();
    render(<EditFieldMappingDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          normalizedKey: "email",
          required: true,
          defaultValue: null,
          format: null,
          enumValues: null,
        })
      );
    });
  });

  it("should send trimmed defaultValue and format, or null when empty", async () => {
    const onSubmit = jest.fn();
    render(
      <EditFieldMappingDialog
        {...defaultProps}
        onSubmit={onSubmit}
        fieldMapping={{
          ...defaultFieldMapping,
          defaultValue: "old",
          format: "old",
        }}
      />
    );
    // Clear both — this triggers revalidation since defaultValue and format changed
    fireEvent.change(screen.getByLabelText(/Default Value/), {
      target: { value: "  " },
    });
    fireEvent.change(screen.getByLabelText(/^Format/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    // Confirm the revalidation
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultValue: null,
          format: null,
        })
      );
    });
  });

  // ── Revalidation confirmation ──────────────────────────────────────

  it("should show revalidation warning when normalizedKey is changed", async () => {
    const onSubmit = jest.fn();
    render(<EditFieldMappingDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Normalized Key/), {
      target: { value: "new_key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should show revalidation warning when required is changed", async () => {
    const onSubmit = jest.fn();
    render(
      <EditFieldMappingDialog
        {...defaultProps}
        onSubmit={onSubmit}
        fieldMapping={{ ...defaultFieldMapping, required: false }}
      />
    );
    // Toggle required on
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]); // Required switch
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should show revalidation warning when defaultValue is changed", async () => {
    const onSubmit = jest.fn();
    render(<EditFieldMappingDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Default Value/), {
      target: { value: "new_default" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should NOT show revalidation warning when only sourceField is changed", async () => {
    const onSubmit = jest.fn();
    render(<EditFieldMappingDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Source Field/), {
      target: { value: "new_source" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(screen.queryByText(/trigger re-validation/)).not.toBeInTheDocument();
  });

  it("should call onSubmit when Confirm & Save is clicked after warning", async () => {
    const onSubmit = jest.fn();
    render(<EditFieldMappingDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Normalized Key/), {
      target: { value: "new_key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/trigger re-validation/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ normalizedKey: "new_key" })
      );
    });
  });

  // ── Standard dialog behavior ───────────────────────────────────────

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<EditFieldMappingDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should show Saving... and disable buttons when isPending", () => {
    render(<EditFieldMappingDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <EditFieldMappingDialog
        {...defaultProps}
        serverError={{ message: "Conflict", code: "FM_CONFLICT" }}
      />
    );
    expect(screen.getByText(/Conflict/)).toBeInTheDocument();
    expect(screen.getByText(/FM_CONFLICT/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("should support Enter key submission", async () => {
    const onSubmit = jest.fn();
    render(<EditFieldMappingDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByLabelText(/Source Field/).closest("form")!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it("should set aria-invalid on sourceField when validation fails", async () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Source Field/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Source Field/)).toHaveAttribute(
        "aria-invalid",
        "true"
      );
    });
  });

  it("should have required attribute on sourceField and normalizedKey", () => {
    render(<EditFieldMappingDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Source Field/)).toBeRequired();
    expect(screen.getByLabelText(/Normalized Key/)).toBeRequired();
  });

  // ── Type-aware Format field ──────────────────────────────────────────

  it("should disable Format field when column type does not support it", () => {
    render(
      <EditFieldMappingDialog {...defaultProps} columnDefinitionType="string" />
    );
    expect(screen.getByLabelText(/^Format/)).toBeDisabled();
    expect(screen.getByText("Not used for string columns")).toBeInTheDocument();
  });

  it("should enable Format field with type-specific helper text for date type", () => {
    render(
      <EditFieldMappingDialog {...defaultProps} columnDefinitionType="date" />
    );
    expect(screen.getByLabelText(/^Format/)).not.toBeDisabled();
    expect(screen.getByText(/Date format for parsing/)).toBeInTheDocument();
  });

  it("should enable Format field with type-specific helper text for number type", () => {
    render(
      <EditFieldMappingDialog {...defaultProps} columnDefinitionType="number" />
    );
    expect(screen.getByLabelText(/^Format/)).not.toBeDisabled();
    expect(screen.getByText(/currency for 2 decimals/)).toBeInTheDocument();
  });
});
