import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { NotFoundView } from "../views/NotFound.view";
import { ServerErrorView } from "../views/ServerError.view";
import { LoadingView } from "../views/Loading.view";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { usePostLoginReturnTo } from "../utils/post-login-return-to.util";

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
  // After a login round trip, navigate to the stashed returnTo (e.g. an invite
  // accept link the invitee opened while logged out) exactly once (#585).
  usePostLoginReturnTo();
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
