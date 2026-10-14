import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import type { Member } from "@portalai/core/contracts";

const { render, screen } = await import("./test-utils");
const { RemoveMemberDialog } =
  await import("../components/RemoveMemberDialog.component");

const member = { email: "ada@example.com", name: "Ada" } as unknown as Member;

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  member,
  onConfirm: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("RemoveMemberDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => jest.clearAllMocks());

  it("renders the title and names the member when open", () => {
    render(<RemoveMemberDialog {...defaultProps} />);
    expect(screen.getByText("Remove member")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<RemoveMemberDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Remove member")).not.toBeInTheDocument();
  });

  it("calls onConfirm on Remove", async () => {
    const onConfirm = jest.fn();
    render(<RemoveMemberDialog {...defaultProps} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirms exactly once on a real Enter key press", async () => {
    const onConfirm = jest.fn();
    render(<RemoveMemberDialog {...defaultProps} onConfirm={onConfirm} />);
    screen.getByRole("button", { name: "Remove" }).focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<RemoveMemberDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state and can't be dismissed while pending", async () => {
    const onClose = jest.fn();
    render(
      <RemoveMemberDialog {...defaultProps} onClose={onClose} isPending />
    );
    expect(screen.getByRole("button", { name: "Removing..." })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <RemoveMemberDialog
        {...defaultProps}
        serverError={{
          message: "Can't remove the last owner",
          code: "MEMBER_LAST_OWNER",
        }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("last owner");
  });

  it("renders no FormAlert without a server error", () => {
    render(<RemoveMemberDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
