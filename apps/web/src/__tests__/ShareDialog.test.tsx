import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import userEvent from "@testing-library/user-event";
import { ShareDialogUI } from "../components/ShareDialog.component";
import type { GrantView } from "@portalai/core/contracts";

const baseProps = {
  open: true,
  onClose: jest.fn(),
  resourceLabel: "My Station",
  memberOptions: [
    { value: "u-1", label: "a@x.io" },
    { value: "u-2", label: "b@x.io" },
  ],
  grants: [] as GrantView[],
  onShare: jest.fn(),
  onRevoke: jest.fn(),
  serverError: null,
};

describe("ShareDialogUI (#621)", () => {
  it("renders title, grantee + access selects, and the empty state", () => {
    render(<ShareDialogUI {...baseProps} />);
    expect(screen.getByText(/Share .*My Station/)).toBeInTheDocument();
    expect(screen.getByLabelText("Share with")).toBeInTheDocument();
    expect(screen.getByLabelText("Access")).toBeInTheDocument();
    expect(screen.getByText("Not shared with anyone yet.")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<ShareDialogUI {...baseProps} open={false} />);
    expect(screen.queryByText(/Share .*My Station/)).not.toBeInTheDocument();
  });

  it("shares with the team at read by default on submit", async () => {
    const onShare = jest.fn();
    render(<ShareDialogUI {...baseProps} onShare={onShare} />);
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onShare).toHaveBeenCalledWith({ type: "team" }, "read");
  });

  it("shares with a chosen member at read-write", async () => {
    const onShare = jest.fn();
    render(<ShareDialogUI {...baseProps} onShare={onShare} />);
    // grantee → a@x.io
    fireEvent.mouseDown(screen.getByLabelText("Share with"));
    await userEvent.click(screen.getByRole("option", { name: "a@x.io" }));
    // access → read-write
    fireEvent.mouseDown(screen.getByLabelText("Access"));
    await userEvent.click(
      screen.getByRole("option", { name: /read . write/i })
    );
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onShare).toHaveBeenCalledWith(
      { type: "user", userId: "u-1" },
      "read-write"
    );
  });

  it("lists current shares and revokes one", async () => {
    const onRevoke = jest.fn();
    const grants: GrantView[] = [
      {
        id: "g-1",
        principalType: "user",
        principalId: "u-1",
        principalLabel: "a@x.io",
        access: "read-write",
      },
      {
        id: "g-2",
        principalType: "role",
        principalId: "sysrole:o:member",
        principalLabel: "The team",
        access: "read",
      },
    ];
    render(
      <ShareDialogUI {...baseProps} grants={grants} onRevoke={onRevoke} />
    );
    expect(screen.getByText("a@x.io")).toBeInTheDocument();
    // "The team" also appears as the grantee select's default value, so assert
    // the shares row by its revoke affordance instead.
    expect(
      screen.getByLabelText("Revoke share for The team")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Revoke share for a@x.io"));
    expect(onRevoke).toHaveBeenCalledWith("g-1");
  });

  it("renders a FormAlert when serverError is set", () => {
    render(
      <ShareDialogUI
        {...baseProps}
        serverError={{ message: "You cannot grant that", code: "X" }}
      />
    );
    expect(screen.getByText("You cannot grant that")).toBeInTheDocument();
  });
});
