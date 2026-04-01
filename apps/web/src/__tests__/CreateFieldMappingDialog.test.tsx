import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CreateFieldMappingDialog } = await import(
  "../components/CreateFieldMappingDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  onSearchConnectorEntities: jest.fn<(q: string) => Promise<{ value: string; label: string }[]>>().mockResolvedValue([]),
  onSearchColumnDefinitions: jest.fn<(q: string) => Promise<{ value: string; label: string }[]>>().mockResolvedValue([]),
  onSearchConnectorEntitiesForRefKey: jest.fn<(q: string) => Promise<{ value: string; label: string }[]>>().mockResolvedValue([]),
  onSearchFieldMappings: jest.fn<(q: string) => Promise<{ value: string; label: string }[]>>().mockResolvedValue([]),
  isPending: false,
  serverError: null,
  columnDefinitionId: "cd-1",
  columnDefinitionLabel: "First Name",
};

describe("CreateFieldMappingDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render title and form fields when open", () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    expect(screen.getByText("New Field Mapping")).toBeInTheDocument();
    expect(screen.getByLabelText(/Source Field/)).toBeInTheDocument();
    expect(screen.getByText("Primary Key")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Connector Entity" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Ref Column Definition" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Ref Entity Key" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Ref Bidirectional Field Mapping" })).toBeInTheDocument();
    // Locked column definition field
    const cdField = screen.getByDisplayValue("First Name");
    expect(cdField).toBeDisabled();
  });

  it("should not render when open is false", () => {
    render(<CreateFieldMappingDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("New Field Mapping")).not.toBeInTheDocument();
  });

  it("should show locked Column Definition field with label", () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const cdField = screen.getByDisplayValue("First Name");
    expect(cdField).toHaveValue("First Name");
    expect(cdField).toBeDisabled();
  });

  it("should display validation errors on invalid submit", async () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Source field is required")).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("should set aria-invalid on source field when validation fails", async () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const sourceField = screen.getByLabelText(/Source Field/);
    fireEvent.focus(sourceField);
    fireEvent.blur(sourceField);
    await waitFor(() => {
      expect(sourceField).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("should have required attribute on source field", () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Source Field/)).toBeRequired();
  });

  it("should show source field error on blur", async () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const sourceField = screen.getByLabelText(/Source Field/);
    fireEvent.focus(sourceField);
    fireEvent.blur(sourceField);
    await waitFor(() => {
      expect(screen.getByText("Source field is required")).toBeInTheDocument();
    });
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<CreateFieldMappingDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should show 'Creating...' and disable buttons when pending", () => {
    render(<CreateFieldMappingDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <CreateFieldMappingDialog
        {...defaultProps}
        serverError={{ message: "Duplicate mapping", code: "FIELD_MAPPING_DUPLICATE" }}
      />
    );
    expect(screen.getByText(/Duplicate mapping/)).toBeInTheDocument();
    expect(screen.getByText(/FIELD_MAPPING_DUPLICATE/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(<CreateFieldMappingDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("should have role='alert' on FormAlert when server error is present", () => {
    render(
      <CreateFieldMappingDialog
        {...defaultProps}
        serverError={{ message: "Oops", code: "ERR" }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("should default isPrimaryKey to false", () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeChecked();
  });

  it("should submit form on Enter key press", async () => {
    const onSearchConnectorEntities = jest.fn<(q: string) => Promise<{ value: string; label: string }[]>>().mockResolvedValue([
      { value: "ce-1", label: "Contacts" },
    ]);
    const onSubmit = jest.fn();
    render(
      <CreateFieldMappingDialog
        {...defaultProps}
        onSubmit={onSubmit}
        onSearchConnectorEntities={onSearchConnectorEntities}
      />
    );

    // Fill source field
    fireEvent.change(screen.getByLabelText(/Source Field/), {
      target: { value: "email" },
    });

    // Select connector entity via search
    const connectorEntityInput = screen.getByRole("combobox", { name: "Connector Entity" });
    fireEvent.change(connectorEntityInput, { target: { value: "Contacts" } });
    await waitFor(() => expect(onSearchConnectorEntities).toHaveBeenCalled());
    await waitFor(() => {
      const option = screen.getByRole("option", { name: "Contacts" });
      fireEvent.click(option);
    });

    // Submit via form
    fireEvent.submit(screen.getByLabelText(/Source Field/).closest("form")!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "email",
          isPrimaryKey: false,
        })
      );
    });
  });

  it("should call onSubmit with correct body including null ref fields", async () => {
    const onSearchConnectorEntities = jest.fn<(q: string) => Promise<{ value: string; label: string }[]>>().mockResolvedValue([
      { value: "ce-1", label: "Contacts" },
    ]);
    const onSubmit = jest.fn();
    render(
      <CreateFieldMappingDialog
        {...defaultProps}
        onSubmit={onSubmit}
        onSearchConnectorEntities={onSearchConnectorEntities}
      />
    );

    // Fill source field
    fireEvent.change(screen.getByLabelText(/Source Field/), {
      target: { value: "user_email" },
    });

    // Select connector entity
    const connectorEntityInput = screen.getByRole("combobox", { name: "Connector Entity" });
    fireEvent.change(connectorEntityInput, { target: { value: "Contacts" } });
    await waitFor(() => expect(onSearchConnectorEntities).toHaveBeenCalled());
    await waitFor(() => {
      const option = screen.getByRole("option", { name: "Contacts" });
      fireEvent.click(option);
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        connectorEntityId: "ce-1",
        columnDefinitionId: "cd-1",
        sourceField: "user_email",
        isPrimaryKey: false,
        refColumnDefinitionId: null,
        refEntityKey: null,
        refBidirectionalFieldMappingId: null,
      });
    });
  });

  it("should auto-link aria-describedby to helper text via MUI", async () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const sourceField = screen.getByLabelText(/Source Field/);
    fireEvent.focus(sourceField);
    fireEvent.blur(sourceField);
    await waitFor(() => {
      expect(sourceField).toHaveAttribute("aria-describedby");
    });
  });

  it("should reset form when dialog reopens", async () => {
    const { rerender } = render(<CreateFieldMappingDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Source Field/), {
      target: { value: "some_field" },
    });
    expect(screen.getByLabelText(/Source Field/)).toHaveValue("some_field");

    rerender(<CreateFieldMappingDialog {...defaultProps} open={false} />);
    rerender(<CreateFieldMappingDialog {...defaultProps} open={true} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Source Field/)).toHaveValue("");
    });
  });

  it("should call onSearchConnectorEntities when typing in connector entity select", async () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const connectorEntityInput = screen.getByRole("combobox", { name: "Connector Entity" });
    fireEvent.change(connectorEntityInput, { target: { value: "test" } });
    await waitFor(() => {
      expect(defaultProps.onSearchConnectorEntities).toHaveBeenCalled();
    });
  });

  it("should call onSearchColumnDefinitions when typing in ref column definition select", async () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const refColDefInput = screen.getByRole("combobox", { name: "Ref Column Definition" });
    fireEvent.change(refColDefInput, { target: { value: "test" } });
    await waitFor(() => {
      expect(defaultProps.onSearchColumnDefinitions).toHaveBeenCalled();
    });
  });

  it("should call onSearchFieldMappings when typing in ref bidirectional select", async () => {
    render(<CreateFieldMappingDialog {...defaultProps} />);
    const refBidiInput = screen.getByRole("combobox", { name: "Ref Bidirectional Field Mapping" });
    fireEvent.change(refBidiInput, { target: { value: "test" } });
    await waitFor(() => {
      expect(defaultProps.onSearchFieldMappings).toHaveBeenCalled();
    });
  });
});
