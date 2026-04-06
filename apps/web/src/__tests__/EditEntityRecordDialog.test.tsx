import { jest } from "@jest/globals";

import type { ColumnDefinitionSummary } from "@portalai/core/contracts";

// Mock react-markdown and remark-gfm so jsdom doesn't choke on ESM
jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));
jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

const { render, screen, fireEvent } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { EditEntityRecordDialog } = await import(
  "../components/EditEntityRecordDialog.component"
);

// ── Fixtures ─────────────────────────────────────────────────────────

const columns: ColumnDefinitionSummary[] = [
  { key: "name", label: "Name", type: "string", required: true, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
  { key: "age", label: "Age", type: "number", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
  { key: "active", label: "Active", type: "boolean", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
  { key: "metadata", label: "Metadata", type: "json", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
];

const normalizedData = { name: "Alice", age: 25, active: true, metadata: { key: "val" } };

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  columns,
  normalizedData,
  isPending: false,
  serverError: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Rendering ────────────────────────────────────────────────────────

describe("EditEntityRecordDialog — rendering", () => {
  it("renders dialog title and fields when open={true}", () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    expect(screen.getByText("Edit Record")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByLabelText("Age")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Metadata")).toBeInTheDocument();
  });

  it("does not render when open={false}", () => {
    render(<EditEntityRecordDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Edit Record")).not.toBeInTheDocument();
  });

  it("renders type-appropriate inputs", () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    // boolean → checkbox
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    // number → type=number
    expect(screen.getByLabelText("Age")).toHaveAttribute("type", "number");
    // json → textarea
    expect(screen.getByLabelText("Metadata").tagName).toBe("TEXTAREA");
  });

  it("deserializes existing json to pretty-printed string", () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    expect(screen.getByLabelText("Metadata")).toHaveValue('{\n  "key": "val"\n}');
  });

  it("deserializes existing number to string", () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    expect(screen.getByLabelText("Age")).toHaveValue(25);
  });
});

// ── Submission ───────────────────────────────────────────────────────

describe("EditEntityRecordDialog — submission", () => {
  it("calls onSubmit with updated normalizedData on Save click", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Bob");
    await userEvent.click(screen.getByText("Save"));
    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      normalizedData: expect.objectContaining({ name: "Bob" }),
    });
  });

  it("calls onSubmit on Enter key (form submit)", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Charlie");
    fireEvent.submit(nameField.closest("form")!);
    expect(defaultProps.onSubmit).toHaveBeenCalled();
  });

  it("calls onClose without onSubmit when no changes made", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    await userEvent.click(screen.getByText("Save"));
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("does not call onSubmit when JSON field is invalid", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    const metaField = screen.getByLabelText("Metadata");
    await userEvent.clear(metaField);
    fireEvent.change(metaField, { target: { value: "{bad" } });
    await userEvent.click(screen.getByText("Save"));
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });
});

// ── Cancel / Close ───────────────────────────────────────────────────

describe("EditEntityRecordDialog — cancel", () => {
  it("calls onClose on Cancel click", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

// ── Loading state ────────────────────────────────────────────────────

describe("EditEntityRecordDialog — loading", () => {
  it("shows Saving... and disables buttons when isPending", () => {
    render(<EditEntityRecordDialog {...defaultProps} isPending={true} />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(screen.getByText("Saving...")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });
});

// ── Server errors ────────────────────────────────────────────────────

describe("EditEntityRecordDialog — server errors", () => {
  it("renders FormAlert when serverError is provided", () => {
    render(
      <EditEntityRecordDialog
        {...defaultProps}
        serverError={{ message: "Server exploded", code: "ENTITY_RECORD_UPDATE_FAILED" }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Server exploded/)).toBeInTheDocument();
  });

  it("does not render FormAlert when serverError is null", () => {
    render(<EditEntityRecordDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ── Field validation ─────────────────────────────────────────────────

describe("EditEntityRecordDialog — field validation", () => {
  it("shows required error when clearing a required field and submitting", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    await userEvent.clear(nameField);
    await userEvent.click(screen.getByText("Save"));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("shows JSON parse error for invalid JSON on submit", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    const metaField = screen.getByLabelText("Metadata");
    await userEvent.clear(metaField);
    fireEvent.change(metaField, { target: { value: "{bad" } });
    await userEvent.click(screen.getByText("Save"));
    expect(screen.getByText(/Invalid JSON:/)).toBeInTheDocument();
  });

  it("sets aria-invalid=true on invalid fields", async () => {
    render(<EditEntityRecordDialog {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    await userEvent.clear(nameField);
    await userEvent.click(screen.getByText("Save"));
    expect(nameField).toHaveAttribute("aria-invalid", "true");
  });
});
