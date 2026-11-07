import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
const { DeletePinnedResultDialog } =
  await import("../components/DeletePinnedResultDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  resultName: "Q3 Accounts",
  onConfirm: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("DeletePinnedResultDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and the result name when open", () => {
    render(<DeletePinnedResultDialog {...defaultProps} />);
    expect(screen.getByText("Delete Pinned Result")).toBeInTheDocument();
    expect(screen.getByText("Q3 Accounts")).toBeInTheDocument();
  });

  it("has no axe violations when open (#793)", async () => {
    render(<DeletePinnedResultDialog {...defaultProps} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("has no axe violations with a server error (#793)", async () => {
    render(
      <DeletePinnedResultDialog
        {...defaultProps}
        serverError={{ message: "Something went wrong", code: "TEST_ERROR" }}
      />
    );
    await screen.findByText(/Something went wrong/);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("does not render when closed", () => {
    render(<DeletePinnedResultDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete Pinned Result")).not.toBeInTheDocument();
  });

  it("calls onConfirm on Delete", async () => {
    const onConfirm = jest.fn();
    render(
      <DeletePinnedResultDialog {...defaultProps} onConfirm={onConfirm} />
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // #789: the dialog is a form, and Enter on Delete confirms once, not once
  // for the click and again for the submit.
  it("confirms exactly once on a real Enter key press", async () => {
    const onConfirm = jest.fn();
    render(
      <DeletePinnedResultDialog {...defaultProps} onConfirm={onConfirm} />
    );
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(remove.closest("form")).not.toBeNull();
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<DeletePinnedResultDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state and ignores Enter while pending", async () => {
    const onConfirm = jest.fn();
    render(
      <DeletePinnedResultDialog
        {...defaultProps}
        onConfirm={onConfirm}
        isPending
      />
    );
    const remove = screen.getByRole("button", { name: "Deleting..." });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <DeletePinnedResultDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "PERMISSION_DENIED" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Delete failed");
  });

  it("renders no FormAlert without a server error", () => {
    render(<DeletePinnedResultDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
