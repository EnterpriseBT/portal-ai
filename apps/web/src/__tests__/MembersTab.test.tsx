import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import { MembersTabUI } from "../components/MembersTab.component";
import type { Member, SeatUsage } from "@portalai/core/contracts";

const owner: Member = {
  userId: "u-owner",
  email: "owner@x.com",
  name: "Owner",
  role: "owner",
  joinedAt: 1_784_000_000_000,
};

const base = {
  members: [owner],
  callerRole: "owner" as const,
  callerUserId: "u-owner",
  onChangeRole: jest.fn(),
  onRemoveClick: jest.fn(),
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
