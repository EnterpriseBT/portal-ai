import React, { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routes } from "./router";
import { ThemeName, ThemeProvider } from "@mcp-ui/core";

import "@mcp-ui/core/styles";

// Create a new query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
    },
  },
});

// Create a new router instance
const router = createRouter({
  routeTree: routes,
  context: {
    queryClient,
  },
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export interface AppProviderProps {
  defaultTheme: ThemeName;
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({
  children,
  defaultTheme = "brand",
}) => {
  return (
    <StrictMode>
      <ThemeProvider defaultTheme={defaultTheme}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider defaultTheme="brand">
      <RouterProvider router={router} />
    </AppProvider>
  );
};
