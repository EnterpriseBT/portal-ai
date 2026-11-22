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
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { QueryClient } = await import("@tanstack/react-query");
const { Route } = await import("../routes/invitations.accept");

/**
 * The real accept route, mounted at its URL (#1109). Route files export only
 * `Route`, and the page reads its token from its own match
 * (`Route.useSearch()`), so the test registers the route under a root, as
 * the generated tree does, rather than rendering the component off-route.
 */
function renderAcceptRoute(url: string) {
  const root = createRootRoute();
  Route.update({
    id: "/invitations/accept",
    path: "/invitations/accept",
    getParentRoute: () => root,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([Route]),
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient: new QueryClient() },
  });
  return render(<RouterProvider router={router} />);
}

describe("AcceptInvitationPage (#881)", () => {
  beforeEach(() => calls.splice(0));

  it("never reads the caller's organization before the invitation is accepted", async () => {
    renderAcceptRoute("/invitations/accept?token=tok-1");

    expect(await screen.findByText(/portals ai/i)).toBeInTheDocument();
    expect(calls).toContain("invitations.accept");
    // The token reached the page through the route (#1109): without one the
    // page says the link is incomplete.
    expect(screen.queryByText(/missing its token/i)).not.toBeInTheDocument();
    expect(calls).not.toContain("organizations.current");
    expect(calls).not.toContain("organizations.memberships");
  });
});
