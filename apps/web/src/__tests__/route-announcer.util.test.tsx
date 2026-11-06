import React from "react";
import { jest } from "@jest/globals";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  APP_NAME,
  FOCUS_FALLBACK_MS,
  pageTitle,
  resetRouteAnnouncer,
  useRouteAnnouncer,
} from "../utils/route-announcer.util";

/** A shell like the layouts: nav links, a field, and main#main-content. */
const Shell = () => {
  useRouteAnnouncer();
  return (
    <>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/jobs">Jobs</Link>
        <Link to="/help">Blank</Link>
        <Link to="/stations">Slow</Link>
        <Link to="/connectors">Swap</Link>
      </nav>
      <input aria-label="Search" />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
};

const Slow = () => {
  const [name, setName] = React.useState("Job");
  return (
    <>
      <h1>{name}</h1>
      <button onClick={() => setName("Job 42")}>Load</button>
    </>
  );
};

/** A detail page whose loading h1 is replaced once its data lands. */
const Swap = () => {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(t);
  }, []);
  return ready ? <h1 key="real">Job 42</h1> : <h1 key="placeholder">Job</h1>;
};

const renderApp = (initial = "/", { strict = false } = {}) => {
  const root = createRootRoute({ component: Shell });
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => <h1>Dashboard</h1>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/jobs",
      component: () => <h1>Jobs</h1>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/help",
      component: () => <p>Nothing</p>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/stations",
      component: Slow,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/connectors",
      component: Swap,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  const app = <RouterProvider router={router} />;
  render(strict ? <React.StrictMode>{app}</React.StrictMode> : app);
  return router;
};

beforeEach(() => {
  resetRouteAnnouncer();
  document.title = "";
});

describe("pageTitle", () => {
  it("names the page, then the app", () => {
    expect(pageTitle("  Jobs ")).toBe(`Jobs · ${APP_NAME}`);
  });

  it.each([null, undefined, "   "])(
    "falls back to the app name for %p",
    (text) => {
      expect(pageTitle(text)).toBe(APP_NAME);
    }
  );
});

describe("useRouteAnnouncer (#797)", () => {
  it("titles the first page without moving focus", async () => {
    renderApp();
    await waitFor(() => expect(document.title).toBe(`Dashboard · ${APP_NAME}`));
    expect(document.body).toHaveFocus();
  });

  it("titles and focuses the new page's h1 after a navigation", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("heading", { name: "Dashboard" });
    await user.click(screen.getByRole("link", { name: "Jobs" }));
    const h1 = await screen.findByRole("heading", { name: "Jobs" });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(document.title).toBe(`Jobs · ${APP_NAME}`);
  });

  it("follows a later change to the h1 in the title, without refocusing", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("heading", { name: "Dashboard" });
    await user.click(screen.getByRole("link", { name: "Slow" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Job" })).toHaveFocus()
    );
    await user.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(document.title).toBe(`Job 42 · ${APP_NAME}`));
    expect(screen.getByRole("button", { name: "Load" })).toHaveFocus();
  });

  it("focuses main when the page has no h1", async () => {
    const router = renderApp();
    await screen.findByRole("heading", { name: "Dashboard" });
    jest.useFakeTimers();
    try {
      await act(async () => {
        await router.navigate({ to: "/help" });
      });
      await screen.findByText("Nothing");
      await act(async () => {
        jest.advanceTimersByTime(FOCUS_FALLBACK_MS);
      });
      expect(screen.getByRole("main")).toHaveFocus();
      expect(document.title).toBe(APP_NAME);
    } finally {
      jest.useRealTimers();
    }
  });

  it("leaves focus alone when the user has moved it since navigating", async () => {
    const user = userEvent.setup();
    const router = renderApp();
    await screen.findByRole("heading", { name: "Dashboard" });
    const search = screen.getByRole("textbox", { name: "Search" });
    // Navigation starts from the body, then the user moves into a field
    // before the page's h1 appears.
    await act(async () => {
      const done = router.navigate({ to: "/stations" });
      search.focus();
      await done;
    });
    await user.type(search, "x");
    await screen.findByRole("heading", { name: "Job" });
    expect(search).toHaveFocus();
  });

  it("puts only the page's own heading in the title (no org name)", async () => {
    renderApp("/jobs");
    await waitFor(() => expect(document.title).toBe(`Jobs · ${APP_NAME}`));
  });

  it("carries focus to the real h1 when the loading one is replaced (#797 review)", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("heading", { name: "Dashboard" });
    await user.click(screen.getByRole("link", { name: "Swap" }));
    const real = await screen.findByRole("heading", { name: "Job 42" });
    await waitFor(() => expect(real).toHaveFocus());
    expect(document.title).toBe(`Job 42 · ${APP_NAME}`);
  });

  it("still moves focus under StrictMode, with a layout per route (#797 review)", async () => {
    // Like the app: each route renders its own layout, so every navigation
    // mounts the hook afresh, and StrictMode runs that mount's effects twice.
    const PageLayout = ({ children }: { children: React.ReactNode }) => {
      useRouteAnnouncer();
      return (
        <>
          <nav>
            <Link to="/help">Blank</Link>
          </nav>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </>
      );
    };
    const root = createRootRoute({ component: () => <Outlet /> });
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: () => (
            <PageLayout>
              <h1>Dashboard</h1>
            </PageLayout>
          ),
        }),
        createRoute({
          getParentRoute: () => root,
          path: "/help",
          component: () => (
            <PageLayout>
              <p>Nothing</p>
            </PageLayout>
          ),
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>
    );
    await screen.findByRole("heading", { name: "Dashboard" });
    jest.useFakeTimers();
    try {
      await act(async () => {
        await router.navigate({ to: "/help" });
      });
      await screen.findByText("Nothing");
      await act(async () => {
        jest.advanceTimersByTime(FOCUS_FALLBACK_MS);
      });
      expect(screen.getByRole("main")).toHaveFocus();
    } finally {
      jest.useRealTimers();
    }
  });
});
