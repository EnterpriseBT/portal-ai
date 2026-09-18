import { jest } from "@jest/globals";

// Regression guard for the accept-on-mount bug found in the #585 smoke walk:
// a rejected accept (404/410) left the view stuck on the "Accepting…" spinner
// (the mutation fired on a StrictMode-discarded observer; the ref guard stopped
// the surviving one). The container now drives its outcome from local state via
// a module-deduped promise, so a rejection maps to the right state.

const mutateAsync = jest.fn<(vars: { token: string }) => Promise<unknown>>();
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { invitations: { accept: () => ({ mutateAsync }) } },
}));

const { render, screen, waitFor } = await import("./test-utils");
const { AcceptInvitationView } = await import("../views/AcceptInvitation.view");
const { ApiError } = await import("../utils/api.util");

describe("AcceptInvitationView (container)", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("maps a 404 (INVITATION_NOT_FOUND) to the invalid state — not a stuck spinner", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError("nope", "INVITATION_NOT_FOUND", 404)
    );
    render(<AcceptInvitationView token="tok-invalid" />);
    await waitFor(() =>
      expect(
        screen.getByText("This invitation link is no longer valid")
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByText(/Accepting your invitation/)
    ).not.toBeInTheDocument();
  });

  it("maps a 410 (INVITATION_EXPIRED) to the expired state", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError("gone", "INVITATION_EXPIRED", 410)
    );
    render(<AcceptInvitationView token="tok-expired" />);
    await waitFor(() =>
      expect(
        screen.getByText("This invitation has expired")
      ).toBeInTheDocument()
    );
  });

  it("shows the missing-token state without firing the mutation", () => {
    render(<AcceptInvitationView />);
    expect(
      screen.getByText("This invitation link is incomplete")
    ).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
