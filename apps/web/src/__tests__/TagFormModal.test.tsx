import { jest } from "@jest/globals";
import type { EntityTag } from "@portalai/core/models";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { TagFormModal } = await import(
  "../components/TagFormModal.component"
);

const existingTag: EntityTag = {
  id: "tag-1",
  organizationId: "org-1",
  name: "Production",
  color: "#EF4444",
  description: "Production environment",
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
  tag: null,
};

describe("TagFormModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Create mode ─────────────────────────────────────────────────

  it("should render 'Create Tag' title when tag is null", () => {
    render(<TagFormModal {...defaultProps} />);
    expect(screen.getByText("Create Tag")).toBeInTheDocument();
  });

  it("should render empty form fields in create mode", () => {
    render(<TagFormModal {...defaultProps} />);
    expect(screen.getByLabelText(/Name/)).toHaveValue("");
    expect(screen.getByLabelText(/Color/)).toHaveValue("");
    expect(screen.getByLabelText(/Description/)).toHaveValue("");
  });

  it("should render 'Create' button text in create mode", () => {
    render(<TagFormModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  // ── Edit mode ───────────────────────────────────────────────────

  it("should render 'Edit Tag' title when tag is provided", () => {
    render(<TagFormModal {...defaultProps} tag={existingTag} />);
    expect(screen.getByText("Edit Tag")).toBeInTheDocument();
  });

  it("should populate form fields from tag in edit mode", () => {
    render(<TagFormModal {...defaultProps} tag={existingTag} />);
    expect(screen.getByLabelText(/Name/)).toHaveValue("Production");
    expect(screen.getByLabelText(/Color/)).toHaveValue("#EF4444");
    expect(screen.getByLabelText(/Description/)).toHaveValue(
      "Production environment"
    );
  });

  it("should render 'Update' button text in edit mode", () => {
    render(<TagFormModal {...defaultProps} tag={existingTag} />);
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  // ── Validation ──────────────────────────────────────────────────

  it("should show name required error when submitting empty name", async () => {
    render(<TagFormModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("should show color validation error for invalid hex", async () => {
    render(<TagFormModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Color/), {
      target: { value: "not-a-color" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(
        screen.getByText("Color must be a valid hex code (e.g. #FF0000)")
      ).toBeInTheDocument();
    });
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("should not show color error for valid hex", async () => {
    const onSubmit = jest.fn();
    render(<TagFormModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Test" },
    });
    fireEvent.change(screen.getByLabelText(/Color/), {
      target: { value: "#3B82F6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(
      screen.queryByText("Color must be a valid hex code (e.g. #FF0000)")
    ).not.toBeInTheDocument();
  });

  it("should show field error on blur", async () => {
    render(<TagFormModal {...defaultProps} />);
    const nameField = screen.getByLabelText(/Name/);
    fireEvent.focus(nameField);
    fireEvent.blur(nameField);
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
  });

  // ── Submission ──────────────────────────────────────────────────

  it("should call onSubmit with form data on valid submission", async () => {
    const onSubmit = jest.fn();
    render(<TagFormModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Staging" },
    });
    fireEvent.change(screen.getByLabelText(/Color/), {
      target: { value: "#F59E0B" },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Staging env" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Staging",
        color: "#F59E0B",
        description: "Staging env",
      });
    });
  });

  it("should omit color and description when empty", async () => {
    const onSubmit = jest.fn();
    render(<TagFormModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Minimal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: "Minimal" });
    });
  });

  // ── Pending / errors ────────────────────────────────────────────

  it("should show 'Saving...' and disable buttons when pending", () => {
    render(<TagFormModal {...defaultProps} isPending={true} />);
    expect(
      screen.getByRole("button", { name: "Saving..." })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should display server error message", () => {
    render(
      <TagFormModal
        {...defaultProps}
        serverError="An entity tag with this name already exists"
      />
    );
    expect(
      screen.getByText("An entity tag with this name already exists")
    ).toBeInTheDocument();
  });

  // ── Close ───────────────────────────────────────────────────────

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<TagFormModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
