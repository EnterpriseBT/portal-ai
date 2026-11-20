import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
const { InviteLinkFieldUI } =
  await import("../components/InviteLinkField.component");

const URL = "https://app.example/invitations/accept?token=abc";

describe("InviteLinkFieldUI (#847)", () => {
  it("shows the link read-only, and Copy hands it back", async () => {
    const onCopy = jest.fn();
    render(<InviteLinkFieldUI url={URL} onCopy={onCopy} />);

    const field = screen.getByRole("textbox", { name: "Invite link" });
    expect(field).toHaveValue(URL);
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByText(/copy and share it now/i)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledWith(URL);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <InviteLinkFieldUI url={URL} onCopy={jest.fn()} />
    );
    await expectNoAxeViolations(container);
  });
});
