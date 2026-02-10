import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { LoadingPage } from "./pages/Loading.page";

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
