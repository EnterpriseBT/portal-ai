import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { NotFoundView } from "../views/NotFound.view";
import { ServerErrorView } from "../views/ServerError.view";
import { LoadingView } from "../views/Loading.view";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";

// Define router context interface for type safety
export interface RouterContext {
  queryClient: QueryClient;
}

// Root route with minimal layout
export const Route = createRootRoute({
  pendingComponent: LoadingRoute,
  component: RootComponent,
  notFoundComponent: NotFoundRoute,
  errorComponent: ErrorRoute,
});

function RootComponent() {
  return <Outlet />;
}

function LoadingRoute() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <LoadingView />
      </AuthorizedLayout>
    </Authorized>
  );
}

function NotFoundRoute() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <NotFoundView showBackButton />
      </AuthorizedLayout>
    </Authorized>
  );
}

function ErrorRoute() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <ServerErrorView showBackButton />
      </AuthorizedLayout>
    </Authorized>
  );
}
