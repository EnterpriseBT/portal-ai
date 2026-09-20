import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { MemberListUI } from "../components/MemberList.component";
import type { Member } from "@portalai/core/contracts";

const member = (over: Partial<Member> = {}): Member => ({
  userId: "u-x",
  email: "x@example.com",
  name: "X",
  roles: ["member"],
  role: "member",
  joinedAt: 1_784_000_000_000,
  ...over,
});

const owner = member({
  userId: "u-owner",
  email: "owner@x.com",
  role: "owner",
});
const admin = member({
  userId: "u-admin",
  email: "admin@x.com",
  role: "admin",
});
const plain = member({
  userId: "u-plain",
  email: "plain@x.com",
  role: "member",
});

describe("MemberListUI", () => {
  it("owner caller: role Select on non-owner rows, none on the owner row", () => {
    render(
      <MemberListUI
        members={[owner, admin]}
        callerRole="owner"
        callerUserId="u-owner"
        onChangeRole={jest.fn()}
        onRemove={jest.fn()}
      />
    );
    expect(screen.getByLabelText("Role for admin@x.com")).toBeInTheDocument();
    // The owner row shows a static chip, not an editable select.
    expect(
      screen.queryByLabelText("Role for owner@x.com")
    ).not.toBeInTheDocument();
  });

  it("admin caller: no role Selects (re-role is owner-only)", () => {
    render(
      <MemberListUI
        members={[owner, admin, plain]}
        callerRole="admin"
        callerUserId="u-admin"
        onChangeRole={jest.fn()}
        onRemove={jest.fn()}
      />
    );
    expect(screen.queryByLabelText(/^Role for /)).not.toBeInTheDocument();
  });

  it("remove is disabled for self and for the last owner", () => {
    render(
      <MemberListUI
        members={[owner, plain]}
        callerRole="owner"
        callerUserId="u-plain" // caller is the plain member (self)
        onChangeRole={jest.fn()}
        onRemove={jest.fn()}
      />
    );
    // Last (sole) owner — cannot remove.
    expect(screen.getByLabelText("Remove owner@x.com")).toBeDisabled();
    // Self — cannot remove.
    expect(screen.getByLabelText("Remove plain@x.com")).toBeDisabled();
  });

  it("fires onRemove for a removable member", async () => {
    const onRemove = jest.fn();
    render(
      <MemberListUI
        members={[owner, admin]} // caller is owner; admin is removable
        callerRole="owner"
        callerUserId="u-owner"
        onChangeRole={jest.fn()}
        onRemove={onRemove}
      />
    );
    await userEvent.click(screen.getByLabelText("Remove admin@x.com"));
    expect(onRemove).toHaveBeenCalledWith(admin);
  });
});
