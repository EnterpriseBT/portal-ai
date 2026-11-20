import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import type { InvitationBlockContent } from "@portalai/core/contracts";

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
const { InvitationBlockUI } =
  await import("../components/InvitationBlock.component");

const content: InvitationBlockContent = {
  type: "invitation",
  invitationId: "inv-1",
  email: "alice@example.com",
  role: "member",
  status: "pending",
  expiresAt: Date.UTC(2026, 11, 1),
};

describe("InvitationBlockUI (#847)", () => {
  it("shows who it's for, the role and the expiry, and never a link", () => {
    render(
      <InvitationBlockUI
        content={content}
        expiresAt={content.expiresAt}
        getLinkGate={{ kind: "allow" }}
        onGetLink={jest.fn()}
      />
    );
    const block = screen.getByRole("region", {
      name: "Invitation: alice@example.com",
    });
    expect(block).toHaveTextContent("alice@example.com");
    expect(block).toHaveTextContent("Member");
    expect(block).toHaveTextContent(/expires/i);
    expect(block).not.toHaveTextContent(/https?:|token/);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Get invite link calls back; a hidden gate shows no button", async () => {
    const onGetLink = jest.fn();
    const { rerender } = render(
      <InvitationBlockUI
        content={content}
        expiresAt={content.expiresAt}
        getLinkGate={{ kind: "allow" }}
        onGetLink={onGetLink}
      />
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Get invite link" }));
    expect(onGetLink).toHaveBeenCalledTimes(1);

    rerender(
      <InvitationBlockUI
        content={content}
        expiresAt={content.expiresAt}
        getLinkGate={{ kind: "hide" }}
        onGetLink={onGetLink}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Get invite link" })
    ).not.toBeInTheDocument();
  });

  it("while a link is being made, the button stays focusable and reads as unavailable", async () => {
    const onGetLink = jest.fn();
    render(
      <InvitationBlockUI
        content={content}
        expiresAt={content.expiresAt}
        getLinkGate={{ kind: "disable", reason: "Generating a link…" }}
        onGetLink={onGetLink}
      />
    );
    const button = screen.getByRole("button", { name: "Get invite link" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await userEvent.setup().click(button);
    expect(onGetLink).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <InvitationBlockUI
        content={content}
        expiresAt={content.expiresAt}
        getLinkGate={{ kind: "allow" }}
        onGetLink={jest.fn()}
      />
    );
    await expectNoAxeViolations(container);
  });
});
