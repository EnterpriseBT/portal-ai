import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import type { InvitationBlockContent } from "@portalai/core/contracts";

// #847: the container behind the invitation block. "Get invite link" goes
// through the resend endpoint Settings uses, and the fresh link lives only in
// the dialog it opens.

type MutateOptions = {
  invalidate?: unknown[];
  toast?: { error?: string };
  onSuccess?: (r: { inviteUrl?: string; expiresAt: number }) => void;
};
const mutate =
  jest.fn<(vars: { id: string }, options: MutateOptions) => void>();
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { invitations: { resend: () => ({ mutate, isPending: false }) } },
}));
jest.unstable_mockModule("../utils/use-capabilities.util", () => ({
  useCapabilities: () => ({ can: () => true }),
}));

const { render, screen, waitFor } = await import("./test-utils");
const { InvitationBlock } =
  await import("../components/InvitationBlock.component");
const { queryKeys } = await import("../api/keys");

const content: InvitationBlockContent = {
  type: "invitation",
  invitationId: "inv-1",
  email: "alice@example.com",
  role: "member",
  status: "pending",
  expiresAt: Date.UTC(2026, 11, 1),
};
const URL = "https://app.example/invitations/accept?token=fresh";

describe("InvitationBlock (container, #847)", () => {
  const user = userEvent.setup();

  beforeEach(() => mutate.mockReset());

  it("resends this invitation and opens the fresh link in a dialog", async () => {
    mutate.mockImplementation((_vars, options) =>
      options.onSuccess?.({ inviteUrl: URL, expiresAt: Date.UTC(2027, 0, 15) })
    );
    render(<InvitationBlock content={content} />);
    const before = screen.getByTestId("invitation-block").textContent;

    await user.click(screen.getByRole("button", { name: "Get invite link" }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "inv-1" },
      expect.objectContaining({
        invalidate: [queryKeys.invitations.root],
        toast: { error: "Couldn't generate a link" },
      })
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      URL
    );
    // The resend extended the expiry; the block shows the new date.
    expect(screen.getByTestId("invitation-block").textContent).not.toBe(before);
    expect(screen.getByTestId("invitation-block")).toHaveTextContent("2027");
  });

  it("drops the link when the dialog closes", async () => {
    mutate.mockImplementation((_vars, options) =>
      options.onSuccess?.({ inviteUrl: URL, expiresAt: content.expiresAt })
    );
    render(<InvitationBlock content={content} />);
    await user.click(screen.getByRole("button", { name: "Get invite link" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(screen.queryByDisplayValue(URL)).not.toBeInTheDocument();
  });

  it("opens no dialog when the resend fails (its toast reports it)", async () => {
    mutate.mockImplementation(() => undefined);
    render(<InvitationBlock content={content} />);
    await user.click(screen.getByRole("button", { name: "Get invite link" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
