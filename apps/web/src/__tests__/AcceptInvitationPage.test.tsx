import { jest } from "@jest/globals";

// #881: /current and /memberships self-provision a caller with no live
// membership. The accept page must not call them before the accept POST, or
// an invitee without one (removed from their last org, or an unverified or
// mismatched new user) gets a stray personal org on top of the invited one.
// Every sdk.<domain>.<action>() call is recorded and answered inertly, so the
// test fails on any page chrome that reads the caller's org.

const calls: string[] = [];
const inert = () => ({
  data: undefined,
  isLoading: false,
  isPending: false,
  error: null,
  user: { name: "Invitee" },
  isAuthenticated: true,
  mutate: jest.fn(),
  mutateAsync: jest.fn(() => new Promise(() => {})),
  logout: jest.fn(),
});
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: new Proxy(
    {},
    {
      get: (_t, domain: string) =>
        new Proxy(
          {},
          {
            get: (_u, action: string) => () => {
              calls.push(`${domain}.${action}`);
              return inert();
            },
          }
        ),
    }
  ),
  queryKeys: new Proxy({}, { get: () => ({ root: ["x"] }) }),
}));

const { render, screen } = await import("./test-utils");
const { Route } = await import("../routes/invitations.accept");
// The route's own component (#1109: route files export only `Route`). It
// reads the token from the location, so the test starts at the accept URL.
const AcceptInvitationPage = Route.options.component!;

describe("AcceptInvitationPage (#881)", () => {
  beforeEach(() => calls.splice(0));

  it("never reads the caller's organization before the invitation is accepted", async () => {
    render(<AcceptInvitationPage />, {
      initialPath: "/invitations/accept?token=tok-1",
    });

    expect(await screen.findByText(/portals ai/i)).toBeInTheDocument();
    expect(calls).toContain("invitations.accept");
    // The token came through the URL (#1109): without one the page says so.
    expect(screen.queryByText(/missing its token/i)).not.toBeInTheDocument();
    expect(calls).not.toContain("organizations.current");
    expect(calls).not.toContain("organizations.memberships");
  });
});
