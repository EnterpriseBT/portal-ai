import { jest } from "@jest/globals";
import type { EntityTag } from "@portalai/core/models";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { TagFormModal } = await import(
  "../components/TagFormModal.component"
);

// Mock canvas context for ColorPicker's color wheel
jest
  .spyOn(HTMLCanvasElement.prototype, "getContext")
  .mockReturnValue({
    clearRect: jest.fn(),
    createImageData: jest.fn().mockReturnValue({
      data: new Uint8ClampedArray(4),
    }),
    putImageData: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    strokeStyle: "",
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D);

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
    expect(screen.getByLabelText(/Description/)).toHaveValue("");
  });

  it("should render color picker with default color samples", () => {
    render(<TagFormModal {...defaultProps} />);
    expect(screen.getByLabelText("Hex color value")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle color picker")).toBeInTheDocument();
    expect(screen.getByText("Samples")).toBeInTheDocument();
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
    expect(screen.getByLabelText("Hex color value")).toHaveValue("#EF4444");
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

  it("should submit with color when a sample is clicked", async () => {
    const onSubmit = jest.fn();
    render(<TagFormModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByLabelText("Select color Red"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Test",
        color: "#ef4444",
      });
    });
  });

  it("should submit with color when valid hex is typed", async () => {
    const onSubmit = jest.fn();
    render(<TagFormModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Test" },
    });
    fireEvent.change(screen.getByLabelText("Hex color value"), {
      target: { value: "#3B82F6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Test",
        color: "#3B82F6",
      });
    });
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
    fireEvent.change(screen.getByLabelText("Hex color value"), {
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

  it("should omit color and description when not changed", async () => {
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
