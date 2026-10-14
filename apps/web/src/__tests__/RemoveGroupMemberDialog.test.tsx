import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen } = await import("./test-utils");
const { RemoveGroupMemberDialog } =
  await import("../components/RemoveGroupMemberDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("RemoveGroupMemberDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and the question when open", () => {
    render(<RemoveGroupMemberDialog {...defaultProps} />);
    expect(screen.getByText("Remove Member")).toBeInTheDocument();
    expect(
      screen.getByText(/remove this member from the group/i)
    ).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<RemoveGroupMemberDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Remove Member")).not.toBeInTheDocument();
  });

  it("calls onConfirm on Remove", async () => {
    const onConfirm = jest.fn();
    render(<RemoveGroupMemberDialog {...defaultProps} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // #789: the dialog is a form, and Enter on Remove confirms once, not once
  // for the click and again for the submit.
  it("confirms exactly once on a real Enter key press", async () => {
    const onConfirm = jest.fn();
    render(<RemoveGroupMemberDialog {...defaultProps} onConfirm={onConfirm} />);
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove.closest("form")).not.toBeNull();
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<RemoveGroupMemberDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state and ignores Enter while pending", async () => {
    const onConfirm = jest.fn();
    render(
      <RemoveGroupMemberDialog
        {...defaultProps}
        onConfirm={onConfirm}
        isPending
      />
    );
    const remove = screen.getByRole("button", { name: "Removing..." });
    expect(remove).toBeDisabled();
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <RemoveGroupMemberDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "PERMISSION_DENIED" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Delete failed");
  });

  it("renders no FormAlert without a server error", () => {
    render(<RemoveGroupMemberDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
