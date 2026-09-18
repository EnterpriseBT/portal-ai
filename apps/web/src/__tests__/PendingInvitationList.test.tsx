import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import { PendingInvitationListUI } from "../components/PendingInvitationList.component";
import type { InvitationResponse } from "@portalai/core/contracts";

const NOW = 1_784_000_000_000;

const invite = (
  over: Partial<InvitationResponse> = {}
): InvitationResponse => ({
  id: "inv-1",
  organizationId: "org-1",
  email: "pending@example.com",
  role: "member",
  status: "pending",
  expiresAt: NOW + 86_400_000,
  invitedByUserId: "u-owner",
  acceptedByUserId: null,
  acceptedAt: null,
  created: NOW,
  createdBy: "u-owner",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...over,
});

describe("PendingInvitationListUI", () => {
  it("renders a row per pending invitation", () => {
    render(
      <PendingInvitationListUI
        invitations={[
          invite(),
          invite({ id: "inv-2", email: "b@example.com" }),
        ]}
        onResend={jest.fn()}
        onRevoke={jest.fn()}
        now={NOW}
      />
    );
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
  });

  it("shows an empty message when there are no invitations", () => {
    render(
      <PendingInvitationListUI
        invitations={[]}
        onResend={jest.fn()}
        onRevoke={jest.fn()}
        now={NOW}
      />
    );
    expect(screen.getByText("No pending invitations.")).toBeInTheDocument();
  });

  it("calls onResend / onRevoke with the row's invitation", () => {
    const onResend = jest.fn();
    const onRevoke = jest.fn();
    const row = invite();
    render(
      <PendingInvitationListUI
        invitations={[row]}
        onResend={onResend}
        onRevoke={onRevoke}
        now={NOW}
      />
    );
    screen.getByLabelText("Resend invitation to pending@example.com").click();
    expect(onResend).toHaveBeenCalledWith(row);
    screen.getByLabelText("Revoke invitation to pending@example.com").click();
    expect(onRevoke).toHaveBeenCalledWith(row);
  });

  it("flags an invitation past its expiry", () => {
    render(
      <PendingInvitationListUI
        invitations={[invite({ expiresAt: NOW - 1 })]}
        onResend={jest.fn()}
        onRevoke={jest.fn()}
        now={NOW}
      />
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});
