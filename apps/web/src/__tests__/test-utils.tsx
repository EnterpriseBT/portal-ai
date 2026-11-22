import React from "react";
import { render, RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@portalai/core/ui";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterContextProvider,
} from "@tanstack/react-router";
import { LayoutProvider } from "../providers/Layout.provider";
import { ToastProvider } from "../providers/Toast.provider";
import { AuthContext, NormalizedAuth } from "../providers/Auth.provider";

// A default normalized auth so components rendered here that read the auth seam
// (#607) — directly via `useAuth()` or through `sdk.auth.*` — don't hit the
// "must be used within an AuthProvider" guard. Tests that need a specific
// session pass `auth`. Bypasses the real vendor bridge, so no Auth0/OIDC SDK is
// mounted in unit tests.
const defaultAuth: NormalizedAuth = {
  session: {
    user: { name: "Test User", picture: "https://example.com/pic.jpg" },
    isAuthenticated: true,
    isLoading: false,
    error: undefined,
  },
  getToken: async () => "test-token",
  login: {
    withGoogle: () => {},
    withUniversal: () => {},
    withQaConnection: () => {},
    withEnterpriseConnection: () => {},
  },
  logout: () => {},
};

const createTestRouter = () => {
  const rootRoute = createRootRoute();
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient() },
  });
};

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
  auth?: Partial<NormalizedAuth>;
}

function renderWithProviders(
  ui: React.ReactElement,
  {
    queryClient = new QueryClient(),
    auth,
    ...options
  }: CustomRenderOptions = {}
) {
  const testRouter = createTestRouter();
  const authValue: NormalizedAuth = { ...defaultAuth, ...auth };

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthContext.Provider value={authValue}>
        <ThemeProvider defaultTheme="brand">
          <QueryClientProvider client={queryClient}>
            <LayoutProvider>
              {/* Mirrors Application.provider's chain (#293): inside the theme,
                  outside the router. Without it, any component under test that
                  raises a toast would silently hit the no-op fallback. */}
              <ToastProvider>
                <RouterContextProvider router={testRouter}>
                  {children}
                </RouterContextProvider>
              </ToastProvider>
            </LayoutProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </AuthContext.Provider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  };
}

/**
 * Presses a real Enter in `element` (#789). In a field, that's the browser's
 * implicit submission, so it submits only when the dialog's default button
 * isn't disabled; on a focused button it's a click. `fireEvent.submit`
 * skipped all of that, so it passed even when Enter did nothing.
 */
export async function pressEnter(element: HTMLElement): Promise<void> {
  element.focus();
  await userEvent.keyboard("{Enter}");
}

/**
 * jsdom has no layout or computed colour, and a component rendered on its own
 * sits in no landmark, so these two rules can only report noise here.
 * Contrast is held by core's `theme-contrast.test.ts` instead. Mirrors
 * `packages/core/src/__tests__/axe.util.ts`; keep the two lists the same.
 */
export const JSDOM_DISABLED_AXE_RULES = ["color-contrast", "region"] as const;

/**
 * Asserts that `container` has no axe violations (WCAG 2.2 AA and best
 * practice), apart from the rules jsdom can't evaluate and any the caller
 * disables with a reason. jest-axe loads, and its matcher registers, on
 * first use: every suite imports this file, and most never call it.
 */
export async function expectNoAxeViolations(
  container: Element,
  options: { disableRules?: readonly string[] } = {}
): Promise<void> {
  // CommonJS: Jest's ESM mode exposes only the default export.
  const { default: jestAxe } = await import("jest-axe");
  const disabled = [
    ...JSDOM_DISABLED_AXE_RULES,
    ...(options.disableRules ?? []),
  ];
  const results = await jestAxe.axe(container, {
    rules: Object.fromEntries(disabled.map((id) => [id, { enabled: false }])),
  });
  expect.extend(jestAxe.toHaveNoViolations);
  expect(results).toHaveNoViolations();
}

export * from "@testing-library/react";
export { renderWithProviders as render };
