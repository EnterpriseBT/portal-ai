import { jest } from "@jest/globals";
import type { EntityTag } from "@portalai/core/models";

const { render, screen, fireEvent, pressEnter, expectNoAxeViolations } =
  await import("./test-utils");
const { DeleteTagDialog } =
  await import("../components/DeleteTagDialog.component");

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

  it("has no axe violations when open (#793)", async () => {
    render(<DeleteTagDialog {...defaultProps} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("is described by its message (#793)", async () => {
    render(<DeleteTagDialog {...defaultProps} />);
    expect(await screen.findByRole("dialog")).toHaveAccessibleDescription(/\w/);
  });

  it("has no axe violations with a server error (#793)", async () => {
    render(
      <DeleteTagDialog
        {...defaultProps}
        serverError={{ message: "Something went wrong", code: "TEST_ERROR" }}
      />
    );
    await screen.findByText(/Something went wrong/);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
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

  it("should submit on Enter key press (form submission)", async () => {
    const onConfirm = jest.fn();
    render(<DeleteTagDialog {...defaultProps} onConfirm={onConfirm} />);
    await pressEnter(screen.getByRole("button", { name: "Delete" }));
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
    expect(screen.getByRole("button", { name: "Deleting..." })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
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

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeleteTagDialog
        {...defaultProps}
        serverError={{ message: "Tag not found", code: "TAG_NOT_FOUND" }}
      />
    );
    expect(screen.getByText(/Tag not found/)).toBeInTheDocument();
    expect(screen.getByText(/TAG_NOT_FOUND/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(<DeleteTagDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
