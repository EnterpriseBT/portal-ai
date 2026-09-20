import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import { MembersTabUI } from "../components/MembersTab.component";
import type { Member, SeatUsage } from "@portalai/core/contracts";

const owner: Member = {
  userId: "u-owner",
  email: "owner@x.com",
  name: "Owner",
  roles: ["owner"],
  joinedAt: 1_784_000_000_000,
};

const base = {
  members: [owner],
  invitations: [],
  canManageRoles: true,
  callerUserId: "u-owner",
  onSetRoles: jest.fn(),
  onRemoveClick: jest.fn(),
  onInviteClick: jest.fn(),
  onResend: jest.fn(),
  onRevoke: jest.fn(),
  canInvite: true,
  lastInviteUrl: null,
  onCopyLink: jest.fn(),
  onDismissLink: jest.fn(),
};

describe("MembersTabUI seat-usage indicator", () => {
  it("shows 'N / M seats used' when a cap is set", () => {
    const seatUsage: SeatUsage = { used: 2, max: 5 };
    render(<MembersTabUI {...base} seatUsage={seatUsage} />);
    expect(screen.getByText("2 / 5 seats used")).toBeInTheDocument();
  });

  it("shows a plain member count when the cap is unlimited (max null)", () => {
    const seatUsage: SeatUsage = { used: 1, max: null };
    render(<MembersTabUI {...base} seatUsage={seatUsage} />);
    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it("renders the member list", () => {
    render(<MembersTabUI {...base} seatUsage={{ used: 1, max: null }} />);
    expect(screen.getByText("owner@x.com")).toBeInTheDocument();
  });

  it("surfaces a load error inline", () => {
    render(
      <MembersTabUI
        {...base}
        seatUsage={{ used: 0, max: null }}
        error={new Error("boom")}
      />
    );
    // StatusMessage renders the error; the list is not shown.
    expect(screen.queryByText("owner@x.com")).not.toBeInTheDocument();
  });
});

describe("MembersTabUI invite + pending (#585)", () => {
  it("invokes onInviteClick from the Invite button", () => {
    const onInviteClick = jest.fn();
    render(
      <MembersTabUI
        {...base}
        seatUsage={{ used: 1, max: 5 }}
        onInviteClick={onInviteClick}
      />
    );
    screen.getByRole("button", { name: "Invite member" }).click();
    expect(onInviteClick).toHaveBeenCalled();
  });

  it("disables the Invite button when the seat cap is reached", () => {
    render(
      <MembersTabUI
        {...base}
        seatUsage={{ used: 5, max: 5 }}
        canInvite={false}
      />
    );
    expect(
      screen.getByRole("button", { name: "Invite member" })
    ).toBeDisabled();
  });

  it("shows the one-time invite link with a Copy control", () => {
    const onCopyLink = jest.fn();
    render(
      <MembersTabUI
        {...base}
        seatUsage={{ used: 2, max: 5 }}
        lastInviteUrl="https://app.local/accept?token=abc"
        onCopyLink={onCopyLink}
      />
    );
    expect(screen.getByLabelText("Invite link")).toHaveValue(
      "https://app.local/accept?token=abc"
    );
    screen.getByRole("button", { name: "Copy" }).click();
    expect(onCopyLink).toHaveBeenCalledWith(
      "https://app.local/accept?token=abc"
    );
  });

  it("renders pending invitations", () => {
    render(
      <MembersTabUI
        {...base}
        seatUsage={{ used: 2, max: 5 }}
        invitations={[
          {
            id: "inv-1",
            organizationId: "org-1",
            email: "pending@example.com",
            role: "member",
            status: "pending",
            expiresAt: 1_784_100_000_000,
            invitedByUserId: "u-owner",
            acceptedByUserId: null,
            acceptedAt: null,
            created: 1_784_000_000_000,
            createdBy: "u-owner",
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
        ]}
      />
    );
    expect(screen.getByText("Pending invitations")).toBeInTheDocument();
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
  });
});
