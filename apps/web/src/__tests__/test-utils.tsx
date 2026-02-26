import React from "react";
import { render, RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mcp-ui/core/ui";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterContextProvider,
} from "@tanstack/react-router";
import { LayoutProvider } from "../providers/Layout.provider";

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
}

function renderWithProviders(
  ui: React.ReactElement,
  { queryClient = new QueryClient(), ...options }: CustomRenderOptions = {}
) {
  const testRouter = createTestRouter();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ThemeProvider defaultTheme="brand">
        <QueryClientProvider client={queryClient}>
          <LayoutProvider>
            <RouterContextProvider router={testRouter}>
              {children}
            </RouterContextProvider>
          </LayoutProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  };
}

export * from "@testing-library/react";
export { renderWithProviders as render };
