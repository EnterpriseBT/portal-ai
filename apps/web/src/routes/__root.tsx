import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { PublicLayout } from "../layouts/Public.layout";
import { NotFoundView } from "../views/NotFound.view";
import { ServerErrorView } from "../views/ServerError.view";

// Define router context interface for type safety
export interface RouterContext {
  queryClient: QueryClient;
}

// Root route with minimal layout
export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundRoute,
  errorComponent: ErrorRoute,
});

function RootComponent() {
  return <Outlet />;
}

function NotFoundRoute() {
  return (
    <PublicLayout>
      <NotFoundView showBackButton />
    </PublicLayout>
  );
}

function ErrorRoute() {
  return (
    <PublicLayout>
      <ServerErrorView showBackButton />
    </PublicLayout>
  );
}
