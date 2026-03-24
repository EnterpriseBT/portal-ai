import { jest } from "@jest/globals";
import type { EntityTag } from "@portalai/core/models";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteTagDialog } = await import(
  "../components/DeleteTagDialog.component"
);

const sampleTag: EntityTag = {
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
  onConfirm: jest.fn(),
  isPending: false,
  tag: sampleTag,
};

describe("DeleteTagDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render dialog title", () => {
    render(<DeleteTagDialog {...defaultProps} />);
    expect(screen.getByText("Delete Tag")).toBeInTheDocument();
  });

  it("should display the tag name in the confirmation message", () => {
    render(<DeleteTagDialog {...defaultProps} />);
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("should display the cascade warning message", () => {
    render(<DeleteTagDialog {...defaultProps} />);
    expect(
      screen.getByText(/All entity tag assignments that reference this tag/)
    ).toBeInTheDocument();
  });

  it("should call onConfirm when Delete button is clicked", () => {
    const onConfirm = jest.fn();
    render(<DeleteTagDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onClose when Cancel button is clicked", () => {
    const onClose = jest.fn();
    render(<DeleteTagDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should show 'Deleting...' and disable buttons when pending", () => {
    render(<DeleteTagDialog {...defaultProps} isPending={true} />);
    expect(
      screen.getByRole("button", { name: "Deleting..." })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should not render content when open is false", () => {
    render(<DeleteTagDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete Tag")).not.toBeInTheDocument();
  });

  it("should display different tag name when tag changes", () => {
    const otherTag = { ...sampleTag, id: "tag-2", name: "Staging" };
    render(<DeleteTagDialog {...defaultProps} tag={otherTag} />);
    expect(screen.getByText("Staging")).toBeInTheDocument();
  });
});
