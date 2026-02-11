import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";

// Define router context interface for type safety
export interface RouterContext {
  queryClient: QueryClient;
}

// Root route with minimal layout
export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return <Outlet />;
}
