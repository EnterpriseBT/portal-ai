import { jest } from "@jest/globals";

// #884: after an Auth0 round trip, Authorized returns the user to the page
// they were headed to (an invite accept link), and the landing route never
// renders, so it can't fire its self-provisioning requests first.

type Session = {
  isLoading: boolean;
  isAuthenticated: boolean;
  error?: Error;
};
// A subscribable store, so a session change re-renders the route components
// the way the real context-backed sdk.auth.session() does.
let session: Session = { isLoading: true, isAuthenticated: false };
const listeners = new Set<() => void>();
const setSession = (next: Session) => {
  session = next;
  listeners.forEach((l) => l());
};

jest.unstable_mockModule("../api/sdk", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    sdk: {
      auth: {
        session: function useSession() {
          return useSyncExternalStore(subscribe, () => session);
        },
      },
    },
  };
});

const { render, screen, act } = await import("@testing-library/react");
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
const { PRE_LOGIN_RETURN_TO_KEY, POST_LOGIN_RETURN_TO_KEY } =
  await import("../utils/post-login-return-to.util");

const dashboardRenders = jest.fn();
const Dashboard = () => {
  dashboardRenders();
  return <div>dashboard</div>;
};

function makeRouter(initial: string) {
  const root = createRootRoute({ component: () => <Outlet /> });
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => (
        <Authorized>
          <Dashboard />
        </Authorized>
      ),
    }),
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

const app = (router: ReturnType<typeof makeRouter>) => (
  <ThemeProvider defaultTheme="brand">
    <RouterProvider router={router} />
  </ThemeProvider>
);

beforeEach(() => {
  window.sessionStorage.clear();
  dashboardRenders.mockClear();
});

describe("Authorized — post-login return (#884)", () => {
  it("returns to the stashed page once auth settles, never rendering the landing route", async () => {
    // The Auth0 callback lands on "/" while the provider is still loading.
    setSession({ isLoading: true, isAuthenticated: false });
    const router = makeRouter("/");
    render(app(router));
    await act(async () => {});

    // auth0-react runs onRedirectCallback (the stash) before it settles.
    window.sessionStorage.setItem(
      POST_LOGIN_RETURN_TO_KEY,
      "/invitations/accept?token=t"
    );
    act(() => setSession({ isLoading: false, isAuthenticated: true }));

    expect(await screen.findByText("accept page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/invitations/accept");
    expect(router.state.location.search).toEqual({ token: "t" });
    expect(dashboardRenders).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(POST_LOGIN_RETURN_TO_KEY)).toBeNull();
  });

  it("renders the route straight away when nothing is pending", async () => {
    setSession({ isLoading: false, isAuthenticated: true });
    render(app(makeRouter("/")));
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
  });

  it("renders the route when the pending target is the current page", async () => {
    window.sessionStorage.setItem(POST_LOGIN_RETURN_TO_KEY, "/");
    setSession({ isLoading: false, isAuthenticated: true });
    render(app(makeRouter("/")));
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(POST_LOGIN_RETURN_TO_KEY)).toBeNull();
  });

  it("keeps the accept link as the pre-login target across the redirect to /login", async () => {
    setSession({ isLoading: false, isAuthenticated: false });
    const router = makeRouter("/invitations/accept?token=t");
    render(app(router));

    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(PRE_LOGIN_RETURN_TO_KEY)).toBe(
      "/invitations/accept?token=t"
    );
  });
});
