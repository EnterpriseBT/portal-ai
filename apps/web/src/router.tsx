import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { LoadingPage } from "./pages/Loading.page";
import { createRouter } from "@tanstack/react-router";
import { queryClient } from "./client";

// Root route
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Index route
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LoadingPage,
});

// Create the route tree
export const routes = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
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
