import { jest } from "@jest/globals";

// #884: a logged-out visit to an authorized page remembers it as the
// pre-login target, and the redirect to /login must not overwrite it with the
// login page (Authorized sees the /login location on its way out).

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: {
      session: () => ({ isLoading: false, isAuthenticated: false }),
    },
  },
}));

const { render, screen } = await import("@testing-library/react");
const {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} = await import("@tanstack/react-router");
const { ThemeProvider } = await import("@portalai/core/ui");
const { Authorized } = await import("../components/Authorized.component");
const { PRE_LOGIN_RETURN_TO_KEY } =
  await import("../utils/post-login-return-to.util");

function makeRouter(initial: string) {
  const root = createRootRoute({ component: () => <Outlet /> });
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/invitations/accept",
      component: () => (
        <Authorized>
          <div>accept page</div>
        </Authorized>
      ),
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/login",
      component: () => <div>login page</div>,
    }),
  ];
  return createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
}

beforeEach(() => window.sessionStorage.clear());

describe("Authorized — pre-login target (#884)", () => {
  it("keeps the accept link as the target across the redirect to /login", async () => {
    render(
      <ThemeProvider defaultTheme="brand">
        <RouterProvider router={makeRouter("/invitations/accept?token=t")} />
      </ThemeProvider>
    );

    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(PRE_LOGIN_RETURN_TO_KEY)).toBe(
      "/invitations/accept?token=t"
    );
  });
});
