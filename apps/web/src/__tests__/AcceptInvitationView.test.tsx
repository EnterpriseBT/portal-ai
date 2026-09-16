import { jest } from "@jest/globals";
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
});
