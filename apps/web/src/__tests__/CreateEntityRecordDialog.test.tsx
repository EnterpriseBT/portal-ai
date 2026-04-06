import { jest } from "@jest/globals";

import type { ColumnDefinitionSummary } from "@portalai/core/contracts";

// Mock react-markdown and remark-gfm so jsdom doesn't choke on ESM
jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));
jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

const { render, screen, fireEvent } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { CreateEntityRecordDialog } = await import(
  "../components/CreateEntityRecordDialog.component"
);

// ── Fixtures ─────────────────────────────────────────────────────────

const columns: ColumnDefinitionSummary[] = [
  { key: "name", label: "Name", type: "string", required: true, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
  { key: "age", label: "Age", type: "number", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
  { key: "active", label: "Active", type: "boolean", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
  { key: "metadata", label: "Metadata", type: "json", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
];

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  columns,
  isPending: false,
  serverError: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Rendering ────────────────────────────────────────────────────────

describe("CreateEntityRecordDialog — rendering", () => {
  it("renders dialog title and fields when open={true}", () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    expect(screen.getByText("New Record")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByLabelText("Age")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByLabelText("Metadata")).toBeInTheDocument();
  });

  it("does not render when open={false}", () => {
    render(<CreateEntityRecordDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("New Record")).not.toBeInTheDocument();
  });

  it("renders type-appropriate inputs for each column", () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    // string → text
    expect(screen.getByLabelText(/Name/)).toHaveAttribute("type", "text");
    // number → type=number
    expect(screen.getByLabelText("Age")).toHaveAttribute("type", "number");
    // boolean → checkbox
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    // json → textarea
    expect(screen.getByLabelText("Metadata").tagName).toBe("TEXTAREA");
  });

  it("pre-fills default values from columns", () => {
    const columnsWithDefault: ColumnDefinitionSummary[] = [
      { key: "name", label: "Name", type: "string", required: false, enumValues: null, defaultValue: "Default Name", validationPattern: null, canonicalFormat: null },
    ];
    render(<CreateEntityRecordDialog {...defaultProps} columns={columnsWithDefault} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Default Name");
  });
});

// ── Submission ───────────────────────────────────────────────────────

describe("CreateEntityRecordDialog — submission", () => {
  it("calls onSubmit with serialized normalizedData on Create click", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.type(screen.getByLabelText(/Name/), "Alice");
    await userEvent.click(screen.getByText("Create"));
    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      normalizedData: expect.objectContaining({ name: "Alice" }),
    });
  });

  it("calls onSubmit on Enter key (form submit)", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.type(screen.getByLabelText(/Name/), "Bob");
    fireEvent.submit(screen.getByLabelText(/Name/).closest("form")!);
    expect(defaultProps.onSubmit).toHaveBeenCalled();
  });

  it("does not call onSubmit when required field is empty", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.click(screen.getByText("Create"));
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("does not call onSubmit when JSON field is invalid", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.type(screen.getByLabelText(/Name/), "Alice");
    fireEvent.change(screen.getByLabelText("Metadata"), { target: { value: "{bad" } });
    await userEvent.click(screen.getByText("Create"));
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("serializes boolean false correctly (not null)", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.type(screen.getByLabelText(/Name/), "Alice");
    // Checkbox starts unchecked (false) — don't click it
    await userEvent.click(screen.getByText("Create"));
    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      normalizedData: expect.objectContaining({ active: false }),
    });
  });
});

// ── Cancel / Close ───────────────────────────────────────────────────

describe("CreateEntityRecordDialog — cancel", () => {
  it("calls onClose on Cancel click", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

// ── Loading state ────────────────────────────────────────────────────

describe("CreateEntityRecordDialog — loading", () => {
  it("shows Creating... and disables buttons when isPending", () => {
    render(<CreateEntityRecordDialog {...defaultProps} isPending={true} />);
    expect(screen.getByText("Creating...")).toBeInTheDocument();
    expect(screen.getByText("Creating...")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });
});

// ── Server errors ────────────────────────────────────────────────────

describe("CreateEntityRecordDialog — server errors", () => {
  it("renders FormAlert when serverError is provided", () => {
    render(
      <CreateEntityRecordDialog
        {...defaultProps}
        serverError={{ message: "Server exploded", code: "ENTITY_RECORD_CREATE_FAILED" }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Server exploded/)).toBeInTheDocument();
  });

  it("does not render FormAlert when serverError is null", () => {
    render(<CreateEntityRecordDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ── Field validation ─────────────────────────────────────────────────

describe("CreateEntityRecordDialog — field validation", () => {
  it("shows required error for empty required field on submit", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.click(screen.getByText("Create"));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("shows JSON parse error for invalid JSON on submit", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.type(screen.getByLabelText(/Name/), "Alice");
    fireEvent.change(screen.getByLabelText("Metadata"), { target: { value: "{bad" } });
    await userEvent.click(screen.getByText("Create"));
    expect(screen.getByText(/Invalid JSON:/)).toBeInTheDocument();
  });

  it("sets aria-invalid=true on invalid fields", async () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    await userEvent.click(screen.getByText("Create"));
    expect(screen.getByLabelText(/Name/)).toHaveAttribute("aria-invalid", "true");
  });

  it("sets required attribute on required fields", () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Name/)).toBeRequired();
  });

  it("does not show errors before submit or blur", () => {
    render(<CreateEntityRecordDialog {...defaultProps} />);
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });
});
