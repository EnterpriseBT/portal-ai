import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
const { DeleteCuratedViewDialog } =
  await import("../components/DeleteCuratedViewDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  viewLabel: "Q3 Accounts",
  onConfirm: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("DeleteCuratedViewDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and the view's label when open", () => {
    render(<DeleteCuratedViewDialog {...defaultProps} />);
    expect(screen.getByText("Delete view")).toBeInTheDocument();
    expect(screen.getByText("Q3 Accounts")).toBeInTheDocument();
  });

  it("has no axe violations when open (#793)", async () => {
    render(<DeleteCuratedViewDialog {...defaultProps} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("is described by its message (#793)", async () => {
    render(<DeleteCuratedViewDialog {...defaultProps} />);
    expect(await screen.findByRole("dialog")).toHaveAccessibleDescription(/\w/);
  });

  it("has no axe violations with a server error (#793)", async () => {
    render(
      <DeleteCuratedViewDialog
        {...defaultProps}
        serverError={{ message: "Something went wrong", code: "TEST_ERROR" }}
      />
    );
    await screen.findByText(/Something went wrong/);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("does not render when closed", () => {
    render(<DeleteCuratedViewDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete view")).not.toBeInTheDocument();
  });

  it("calls onConfirm on Delete", async () => {
    const onConfirm = jest.fn();
    render(<DeleteCuratedViewDialog {...defaultProps} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // #758: the dialog is a form, and Enter on Delete confirms once, not once
  // for the click and again for the submit.
  it("confirms exactly once on a real Enter key press", async () => {
    const onConfirm = jest.fn();
    render(<DeleteCuratedViewDialog {...defaultProps} onConfirm={onConfirm} />);
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(remove.closest("form")).not.toBeNull();
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<DeleteCuratedViewDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state and ignores Enter while pending", async () => {
    const onConfirm = jest.fn();
    render(
      <DeleteCuratedViewDialog
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
      <DeleteCuratedViewDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "PERMISSION_DENIED" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Delete failed");
  });

  it("renders no FormAlert without a server error", () => {
    render(<DeleteCuratedViewDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
