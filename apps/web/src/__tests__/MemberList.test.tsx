import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { MemberListUI } from "../components/MemberList.component";
import type { Member, RoleRef } from "@portalai/core/contracts";

// System roles are always assignable; slug == name for them.
const ASSIGNABLE_ROLES: RoleRef[] = [
  { slug: "owner", name: "owner", kind: "system" },
  { slug: "admin", name: "admin", kind: "system" },
  { slug: "member", name: "member", kind: "system" },
];

const member = (over: Partial<Member> = {}): Member => {
  const merged = {
    userId: "u-x",
    email: "x@example.com",
    name: "X",
    roles: ["member"] as Member["roles"],
    groupIds: [],
    joinedAt: 1_784_000_000_000,
    ...over,
  };
  // Default the slug set to mirror the system roles unless a test overrides it.
  return { ...merged, roleSlugs: over.roleSlugs ?? [...merged.roles] };
};

const owner = member({
  userId: "u-owner",
  email: "owner@x.com",
  roles: ["owner"],
});
const admin = member({
  userId: "u-admin",
  email: "admin@x.com",
  roles: ["admin"],
});
const plain = member({
  userId: "u-plain",
  email: "plain@x.com",
  roles: ["member"],
});

describe("MemberListUI (#620)", () => {
  it("canManageRoles: every row shows a roles multi-select", () => {
    render(
      <MemberListUI
        members={[owner, admin]}
        canManageRoles
        callerUserId="u-owner"
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={jest.fn()}
        onRemove={jest.fn()}
      />
    );
    // The owner/admin gating is server-enforced — the editor is shown on all
    // rows when the caller can assign roles.
    expect(screen.getByLabelText("Roles for admin@x.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Roles for owner@x.com")).toBeInTheDocument();
  });

  it("#622: shows the Groups column only when canManageGroups", () => {
    const { rerender } = render(
      <MemberListUI
        members={[owner]}
        canManageRoles
        callerUserId="u-owner"
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={jest.fn()}
        onRemove={jest.fn()}
      />
    );
    // No group column by default.
    expect(screen.queryByLabelText(/^Groups for /)).not.toBeInTheDocument();

    rerender(
      <MemberListUI
        members={[owner]}
        canManageRoles
        callerUserId="u-owner"
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={jest.fn()}
        onRemove={jest.fn()}
        canManageGroups
        groups={[{ id: "g-1", name: "West" }]}
        onSetGroups={jest.fn()}
      />
    );
    expect(screen.getByLabelText("Groups for owner@x.com")).toBeInTheDocument();
  });

  it("#622: the Groups column renders a member's current groups by name", () => {
    render(
      <MemberListUI
        members={[member({ email: "m@x.com", groupIds: ["g-1"] })]}
        canManageRoles
        callerUserId="u-owner"
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={jest.fn()}
        onRemove={jest.fn()}
        canManageGroups
        groups={[
          { id: "g-1", name: "West" },
          { id: "g-2", name: "East" },
        ]}
        onSetGroups={jest.fn()}
      />
    );
    // The assigned group renders by name, not by id.
    expect(screen.getByText("West")).toBeInTheDocument();
  });

  it("without canManageRoles: roles render as chips, no selects", () => {
    render(
      <MemberListUI
        members={[owner, admin, plain]}
        canManageRoles={false}
        callerUserId="u-admin"
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={jest.fn()}
        onRemove={jest.fn()}
      />
    );
    expect(screen.queryByLabelText(/^Roles for /)).not.toBeInTheDocument();
    // Each member's roles are shown by name as chips.
    expect(screen.getAllByText("owner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
  });

  it("remove is disabled for self and for the last owner", () => {
    render(
      <MemberListUI
        members={[owner, plain]}
        canManageRoles
        callerUserId="u-plain" // caller is the plain member (self)
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={jest.fn()}
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
        canManageRoles
        callerUserId="u-owner"
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={jest.fn()}
        onRemove={onRemove}
      />
    );
    await userEvent.click(screen.getByLabelText("Remove admin@x.com"));
    expect(onRemove).toHaveBeenCalledWith(admin);
  });

  it("selecting an additional role fires onSetRoles with the full set", async () => {
    const onSetRoles = jest.fn();
    render(
      <MemberListUI
        members={[
          member({ userId: "u-1", email: "m@x.com", roles: ["member"] }),
        ]}
        canManageRoles
        callerUserId="u-owner"
        assignableRoles={ASSIGNABLE_ROLES}
        onSetRoles={onSetRoles}
        onRemove={jest.fn()}
      />
    );
    // Open the multi-select (MUI opens on mouseDown of the combobox) and add
    // "admin" to the existing "member".
    fireEvent.mouseDown(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "admin" }));
    expect(onSetRoles).toHaveBeenCalledWith(
      "u-1",
      expect.arrayContaining(["member", "admin"])
    );
  });

  it("#622: a custom role is assignable and fires onSetRoles with its slug", async () => {
    const onSetRoles = jest.fn();
    render(
      <MemberListUI
        members={[member({ userId: "u-1", email: "m@x.com" })]}
        canManageRoles
        callerUserId="u-owner"
        assignableRoles={[
          ...ASSIGNABLE_ROLES,
          { slug: "analyst", name: "Analyst", kind: "custom" },
        ]}
        onSetRoles={onSetRoles}
        onRemove={jest.fn()}
      />
    );
    fireEvent.mouseDown(screen.getByRole("combobox"));
    // The custom role shows by display NAME…
    await userEvent.click(screen.getByRole("option", { name: "Analyst" }));
    // …but the set-the-set fires with its SLUG.
    expect(onSetRoles).toHaveBeenCalledWith(
      "u-1",
      expect.arrayContaining(["member", "analyst"])
    );
  });
});
