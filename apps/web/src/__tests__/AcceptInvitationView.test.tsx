import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { render, screen } from "./test-utils";
import {
  AcceptInvitationViewUI,
  type AcceptInvitationStatus,
} from "../views/AcceptInvitation.view";

const renderState = (
  status: AcceptInvitationStatus,
  extra: Partial<{ orgName: string; errorMessage: string }> = {}
) =>
  render(
    <AcceptInvitationViewUI
      status={status}
      onGoHome={jest.fn()}
      orgName={extra.orgName}
      errorMessage={extra.errorMessage}
    />
  );

describe("AcceptInvitationViewUI", () => {
  // #881: the page has no app chrome (it must not read the caller's org), so
  // a failed accept offers sign-out itself, e.g. to switch to the invited
  // account.
  it("offers sign-out when the accept fails, and calls it", async () => {
    const user = userEvent.setup();
    const onSignOut = jest.fn();
    render(
      <AcceptInvitationViewUI
        status="invalid"
        onGoHome={jest.fn()}
        onSignOut={onSignOut}
      />
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("offers no sign-out once the invitation is accepted", () => {
    render(
      <AcceptInvitationViewUI
        status="success"
        orgName="Acme Inc"
        onGoHome={jest.fn()}
        onSignOut={jest.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Sign out" })
    ).not.toBeInTheDocument();
  });

  it("pending: shows a spinner", () => {
    renderState("pending");
    expect(screen.getByLabelText("Accepting invitation")).toBeInTheDocument();
    expect(screen.getByText(/Accepting your invitation/)).toBeInTheDocument();
  });

  it("success: names the joined org (idempotent already-member lands here too)", () => {
    renderState("success", { orgName: "Acme Inc" });
    expect(screen.getByText("Invitation accepted")).toBeInTheDocument();
    expect(
      screen.getByText("You're now a member of Acme Inc.")
    ).toBeInTheDocument();
  });

  it("expired (410): explains the invite is expired", () => {
    renderState("expired");
    expect(screen.getByText("This invitation has expired")).toBeInTheDocument();
  });

  it("invalid (404): explains the link is no longer valid", () => {
    renderState("invalid");
    expect(
      screen.getByText("This invitation link is no longer valid")
    ).toBeInTheDocument();
  });

  it("missingToken: explains the link is incomplete", () => {
    renderState("missingToken");
    expect(
      screen.getByText("This invitation link is incomplete")
    ).toBeInTheDocument();
  });

  it("error: surfaces the server message when present", () => {
    renderState("error", { errorMessage: "Upstream exploded" });
    expect(
      screen.getByText("Couldn't accept this invitation")
    ).toBeInTheDocument();
    expect(screen.getByText("Upstream exploded")).toBeInTheDocument();
  });

  it("calls onGoHome from the dashboard button", () => {
    const onGoHome = jest.fn();
    render(<AcceptInvitationViewUI status="success" onGoHome={onGoHome} />);
    screen.getByRole("button", { name: "Go to dashboard" }).click();
    expect(onGoHome).toHaveBeenCalled();
  });

  // #711 (spec case 19): who to ask, without naming a role.
  it.each([
    ["expired", "Ask the person who invited you for a fresh invite link."],
    [
      "invalid",
      "It may have already been used or been revoked. Ask the person who invited you to resend it.",
    ],
    [
      "error",
      "Something went wrong. Please try again, or ask the person who invited you to resend it.",
    ],
  ] as const)("%s: tells the invitee who to ask, by no role", (state, body) => {
    renderState(state);
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByText(/\badmin\b/i)).not.toBeInTheDocument();
  });
});
