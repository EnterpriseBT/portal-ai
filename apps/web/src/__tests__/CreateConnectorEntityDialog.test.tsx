import { jest } from "@jest/globals";

const mockFetchWithAuth = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  payload: {
    connectorInstances: [
      { id: "ci-1", name: "Writable CRM" },
      { id: "ci-2", name: "Writable ERP" },
    ],
    total: 2,
    limit: 20,
    offset: 0,
  },
});

jest.unstable_mockModule("../utils/api.util", () => ({
  useAuthFetch: () => ({
    fetchWithAuth: mockFetchWithAuth,
  }),
  useAuthQuery: jest.fn(),
  useAuthMutation: jest.fn(),
  toServerError: (err: unknown) => err ?? null,
  ApiError: class extends Error {
    code: string;
    status: number;
    success: false;
    constructor(message: string, code: string, status = 0) {
      super(message);
      this.code = code;
      this.status = status;
      this.success = false;
    }
  },
  ServerError: {},
}));

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CreateConnectorEntityDialog } = await import(
  "../components/CreateConnectorEntityDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
  lockedConnectorInstance: null,
};

const lockedProps = {
  ...defaultProps,
  lockedConnectorInstance: { id: "ci-1", name: "My Connector" },
};

describe("CreateConnectorEntityDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchWithAuth.mockResolvedValue({
      payload: {
        connectorInstances: [
          { id: "ci-1", name: "Writable CRM" },
          { id: "ci-2", name: "Writable ERP" },
        ],
        total: 2,
        limit: 20,
        offset: 0,
      },
    });
  });

  // ── Rendering ──────────────────────────────────────────────────────

  it("should render dialog title and all fields when open", () => {
    render(<CreateConnectorEntityDialog {...defaultProps} />);
    expect(screen.getByText("New Entity")).toBeInTheDocument();
    expect(screen.getByLabelText(/Label/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Key/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Connector Instance" })).toBeInTheDocument();
  });

  it("should not render dialog content when open is false", () => {
    render(<CreateConnectorEntityDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("New Entity")).not.toBeInTheDocument();
  });

  // ── Submission ─────────────────────────────────────────────────────

  it("should call onSubmit with correct payload on Create button click", async () => {
    const onSubmit = jest.fn();
    render(<CreateConnectorEntityDialog {...lockedProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: "Contacts" },
    });
    fireEvent.change(screen.getByLabelText(/Key/), {
      target: { value: "contacts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        label: "Contacts",
        key: "contacts",
        connectorInstanceId: "ci-1",
      });
    });
  });

  it("should call onSubmit on Enter key (form submit)", async () => {
    const onSubmit = jest.fn();
    render(<CreateConnectorEntityDialog {...lockedProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: "Deals" },
    });
    fireEvent.change(screen.getByLabelText(/Key/), {
      target: { value: "deals" },
    });
    fireEvent.submit(screen.getByLabelText(/Label/).closest("form")!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        label: "Deals",
        key: "deals",
        connectorInstanceId: "ci-1",
      });
    });
  });

  it("should not call onSubmit when validation fails", async () => {
    render(<CreateConnectorEntityDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Label is required")).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  // ── Cancel / Close ─────────────────────────────────────────────────

  it("should call onClose on Cancel button click", () => {
    const onClose = jest.fn();
    render(<CreateConnectorEntityDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Loading state ──────────────────────────────────────────────────

  it("should show 'Creating...' and disable buttons when isPending", () => {
    render(<CreateConnectorEntityDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  // ── Server errors ──────────────────────────────────────────────────

  it("should render FormAlert when serverError is provided", () => {
    render(
      <CreateConnectorEntityDialog
        {...defaultProps}
        serverError={{
          message: "Duplicate entity key",
          code: "CONNECTOR_ENTITY_DUPLICATE_KEY",
        }}
      />
    );
    expect(screen.getByText(/Duplicate entity key/)).toBeInTheDocument();
    expect(screen.getByText(/CONNECTOR_ENTITY_DUPLICATE_KEY/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(<CreateConnectorEntityDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ── Field validation ───────────────────────────────────────────────

  it("should show 'Label is required' when label is empty on submit", async () => {
    render(<CreateConnectorEntityDialog {...lockedProps} />);
    fireEvent.change(screen.getByLabelText(/Key/), {
      target: { value: "valid_key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Label is required")).toBeInTheDocument();
    });
  });

  it("should show key format error when key contains invalid characters", async () => {
    render(<CreateConnectorEntityDialog {...lockedProps} />);
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: "My Entity" },
    });
    fireEvent.change(screen.getByLabelText(/Key/), {
      target: { value: "BadKey!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(
        screen.getByText(/Key must start with a lowercase letter/)
      ).toBeInTheDocument();
    });
  });

  it("should show 'Connector instance is required' when no instance selected (unlocked)", async () => {
    render(<CreateConnectorEntityDialog {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: "Contacts" },
    });
    fireEvent.change(screen.getByLabelText(/Key/), {
      target: { value: "contacts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Connector instance is required")).toBeInTheDocument();
    });
  });

  it("should set aria-invalid on invalid fields after failed submit", async () => {
    render(<CreateConnectorEntityDialog {...lockedProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Label/)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(/Key/)).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("should have required attribute on Label and Key fields", () => {
    render(<CreateConnectorEntityDialog {...lockedProps} />);
    expect(screen.getByLabelText(/Label/)).toBeRequired();
    expect(screen.getByLabelText(/Key/)).toBeRequired();
  });

  // ── Locked connector instance ──────────────────────────────────────

  it("should display locked connector instance name in a disabled field", () => {
    render(<CreateConnectorEntityDialog {...lockedProps} />);
    const ciField = screen.getByDisplayValue("My Connector");
    expect(ciField).toBeDisabled();
  });

  it("should use locked connector instance ID in onSubmit payload", async () => {
    const onSubmit = jest.fn();
    render(<CreateConnectorEntityDialog {...lockedProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: "Users" },
    });
    fireEvent.change(screen.getByLabelText(/Key/), {
      target: { value: "users" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ connectorInstanceId: "ci-1" })
      );
    });
  });

  it("should render connector instance as a searchable select when unlocked", () => {
    render(<CreateConnectorEntityDialog {...defaultProps} />);
    expect(screen.getByRole("combobox", { name: "Connector Instance" })).toBeEnabled();
  });
});
