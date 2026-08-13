import { jest } from "@jest/globals";

/**
 * Route-level coverage for `/help`'s search contract (#365).
 *
 * The shared `test-utils.tsx` router registers no file routes, so it cannot
 * exercise `validateSearch` at all. This file builds its own memory router
 * around the **real** declaration from `routes/help.tsx` and renders a probe
 * that reports what `useSearch` resolved — the same pattern
 * `HttpErrorComponent.test.tsx` uses to get a router without the provider
 * stack.
 */

const {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  useSearch,
} = await import("@tanstack/react-router");
const { render, screen, waitFor, within } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { ThemeProvider } = await import("@portalai/core/ui");
const { Route: HelpRoute } = await import("../routes/help");
const { HelpView } = await import("../views/Help.view");
const { FAQCategory, GlossaryCategory } =
  await import("@portalai/core/content");
const { HelpTab } = await import("../utils/routes.util");

/**
 * Reads the search **strictly**, i.e. `validateSearch`'s own output. A loose
 * `useSearch({strict: false})` read merges in the root route's unvalidated
 * params, so unknown keys survive there — which is exactly why `Help.view.tsx`
 * re-normalizes what it reads rather than trusting the route to have cleaned
 * it (and what keeps the view renderable under a router with no file routes).
 */
const SearchProbe = () => {
  const search = useSearch({ from: "/help" });
  return <div data-testid="probe">{JSON.stringify(search)}</div>;
};

const renderAt = (url: string) => {
  const rootRoute = createRootRoute();
  const helpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/help",
    // The contract under test, lifted from the real route declaration.
    validateSearch: HelpRoute.options.validateSearch,
    component: SearchProbe,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([helpRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });

  render(<RouterProvider router={router} />);
  return () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}");
};

describe("/help search contract", () => {
  it("resolves no params to an empty address", async () => {
    const search = renderAt("/help");
    await screen.findByTestId("probe");
    expect(search()).toEqual({});
  });

  it("resolves a tab + category pair on the FAQ tab", async () => {
    const search = renderAt("/help?tab=faq&category=analytics");
    await screen.findByTestId("probe");
    expect(search()).toEqual({
      tab: HelpTab.Faq,
      category: FAQCategory.Analytics,
    });
  });

  it("resolves a tab + category pair on the Glossary tab", async () => {
    const search = renderAt("/help?tab=glossary&category=analytics");
    await screen.findByTestId("probe");
    expect(search()).toEqual({
      tab: HelpTab.Glossary,
      category: GlossaryCategory.Analytics,
    });
  });

  it("drops both params when neither is recognized", async () => {
    const search = renderAt("/help?tab=nonsense&category=nonsense");
    await screen.findByTestId("probe");
    expect(search()).toEqual({});
  });

  it("drops a glossary-only category on the FAQ tab, keeping the tab", async () => {
    const search = renderAt("/help?tab=faq&category=data-modeling");
    await screen.findByTestId("probe");
    expect(search()).toEqual({ tab: HelpTab.Faq });
  });

  it("drops a category that arrives without a tab", async () => {
    const search = renderAt("/help?category=analytics");
    await screen.findByTestId("probe");
    expect(search()).toEqual({});
  });

  it("resolves an anchor-only address", async () => {
    const search = renderAt("/help#faq-entry-why-did-my-job-fail");
    await screen.findByTestId("probe");
    expect(search()).toEqual({});
  });

  it("ignores foreign params without throwing, and leaves them intact", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    // TanStack replaces the keys the validator returns and passes every other
    // key through untouched — so a campaign tag or a malformed `tab[]` rides
    // along harmlessly while the Help contract itself resolves to nothing.
    const search = renderAt("/help?tab[]=faq&utm_source=email");
    await screen.findByTestId("probe");

    const resolved = search() as Record<string, unknown>;
    expect(resolved.tab).toBeUndefined();
    expect(resolved.category).toBeUndefined();
    expect(resolved.utm_source).toBe("email");
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

/**
 * The round trip: the real route + the real container, driven through a memory
 * router. No mocked `useNavigate` — clicking a tab has to actually change the
 * address, and the back button has to actually work, or the feature doesn't.
 */
describe("Help view URL round trip", () => {
  const renderHelpAt = (url: string) => {
    const rootRoute = createRootRoute();
    const helpRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/help",
      validateSearch: HelpRoute.options.validateSearch,
      component: HelpView,
    });

    const router = createRouter({
      routeTree: rootRoute.addChildren([helpRoute]),
      history: createMemoryHistory({ initialEntries: [url] }),
    });

    render(
      <ThemeProvider defaultTheme="brand">
        <RouterProvider router={router} />
      </ThemeProvider>
    );
    return router;
  };

  it("opens Getting Started for a bare /help", async () => {
    renderHelpAt("/help");
    expect(
      await screen.findByRole("tab", { name: "Getting Started" })
    ).toHaveAttribute("aria-selected", "true");
  });

  it("opens the FAQ tab with the Analytics chip active from a deep link", async () => {
    renderHelpAt("/help?tab=faq&category=analytics");

    expect(await screen.findByRole("tab", { name: "FAQ" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const filters = screen.getByTestId("faq-category-filters");
    expect(
      within(filters).getByText("Analytics & Portals").closest(".MuiChip-root")
    ).toHaveClass("MuiChip-colorPrimary");
  });

  it("opens the Glossary tab with the Analytics chip active from a deep link", async () => {
    renderHelpAt("/help?tab=glossary&category=analytics");

    expect(
      await screen.findByRole("tab", { name: "Glossary" })
    ).toHaveAttribute("aria-selected", "true");
    const filters = screen.getByTestId("glossary-category-filters");
    expect(
      within(filters).getByText("Analytics").closest(".MuiChip-root")
    ).toHaveClass("MuiChip-colorPrimary");
  });

  it("opens Getting Started — not an error page — for a nonsense address", async () => {
    renderHelpAt("/help?tab=nonsense&category=nonsense");

    expect(
      await screen.findByRole("tab", { name: "Getting Started" })
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
  });

  it("opens the FAQ tab with no filter when the category belongs to the glossary", async () => {
    renderHelpAt("/help?tab=faq&category=data-modeling");

    expect(await screen.findByRole("tab", { name: "FAQ" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const filters = screen.getByTestId("faq-category-filters");
    expect(
      within(filters).getByText("All").closest(".MuiChip-root")
    ).toHaveClass("MuiChip-colorPrimary");
  });

  it("writes the tab to the address bar when the user switches tabs", async () => {
    const user = userEvent.setup();
    const router = renderHelpAt("/help");

    await user.click(await screen.findByRole("tab", { name: "Glossary" }));

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: "glossary" });
    });
    expect(screen.getByRole("tab", { name: "Glossary" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("pushes a tab change and replaces a category change, so back returns to the previous tab", async () => {
    const user = userEvent.setup();
    const router = renderHelpAt("/help");

    // Push: /help -> /help?tab=glossary
    await user.click(await screen.findByRole("tab", { name: "Glossary" }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: "glossary" });
    });

    // Replace: chip toggling must not accumulate history entries.
    const filters = screen.getByTestId("glossary-category-filters");
    await user.click(within(filters).getByText("Analytics"));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        tab: "glossary",
        category: "analytics",
      });
    });

    // One step back lands on the tab we came from, not the pre-chip URL.
    router.history.back();
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(
      await screen.findByRole("tab", { name: "Getting Started" })
    ).toHaveAttribute("aria-selected", "true");
  });
});
