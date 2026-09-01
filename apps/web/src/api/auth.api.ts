import { useAuth0 } from "@auth0/auth0-react";
import type { Auth0UserProfileGetResponse } from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const auth = {
  session: () => {
    const { user, isAuthenticated, isLoading, error } = useAuth0();
    return { user, isAuthenticated, isLoading, error };
  },

  login: () => {
    const { loginWithRedirect } = useAuth0();
    return {
      withGoogle: () =>
        loginWithRedirect({
          openUrl: (url) => window.location.replace(url),
          authorizationParams: {
            connection: "google-oauth2",
            redirect_uri: window.location.origin,
          },
        }),
      // Universal Login with NO pinned connection, so Auth0 offers every
      // enabled connection (including a Database username/password one). This
      // exists only for the guarded, dev/test-only E2E sign-in affordance
      // (#304): the app's normal login is Google-only, which a headless test
      // user can't drive, so the harness authenticates a Database-connection
      // test user through this path. Never surfaced in production — see the
      // guard in LoginForm.
      withUniversal: () =>
        loginWithRedirect({
          openUrl: (url) => window.location.replace(url),
          authorizationParams: {
            redirect_uri: window.location.origin,
          },
        }),
    };
  },

  logout: () => {
    const { logout } = useAuth0();
    return {
      logout: () =>
        logout({
          logoutParams: { returnTo: window.location.origin },
          openUrl: (url) => window.location.replace(url),
        }),
    };
  },

  profile: (options?: QueryOptions<Auth0UserProfileGetResponse>) =>
    useAuthQuery<Auth0UserProfileGetResponse>(
      queryKeys.auth.profile(),
      "/api/profile",
      undefined,
      options
    ),
};
