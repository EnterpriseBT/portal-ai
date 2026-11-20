import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, waitFor, expectNoAxeViolations } =
  await import("./test-utils");
const { InviteLinkDialogUI } =
  await import("../components/InviteLinkDialog.component");

const URL = "https://app.example/invitations/accept?token=abc";

const defaultProps = {
  open: true,
  email: "alice@example.com",
  url: URL,
  onCopy: jest.fn(),
  onClose: jest.fn(),
};

describe("InviteLinkDialogUI (#847)", () => {
  const user = userEvent.setup();

  beforeEach(() => jest.clearAllMocks());

  it("renders the title and the link when open", async () => {
    render(<InviteLinkDialogUI {...defaultProps} />);
    expect(
      await screen.findByRole("dialog", {
        name: "Invite link for alice@example.com",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      URL
    );
  });

  it("renders nothing when closed or without a link", () => {
    const { rerender } = render(
      <InviteLinkDialogUI {...defaultProps} open={false} />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<InviteLinkDialogUI {...defaultProps} url={null} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts focus on Copy when it opens, and Copy hands the link back", async () => {
    render(<InviteLinkDialogUI {...defaultProps} />);
    const copy = await screen.findByRole("button", { name: "Copy" });
    await waitFor(() => expect(copy).toHaveFocus());
    await user.click(copy);
    expect(defaultProps.onCopy).toHaveBeenCalledWith(URL);
  });

  it("closes from Done and from Escape", async () => {
    render(<InviteLinkDialogUI {...defaultProps} />);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(2);
  });

  it("has no axe violations when open (#793)", async () => {
    render(<InviteLinkDialogUI {...defaultProps} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });
});
