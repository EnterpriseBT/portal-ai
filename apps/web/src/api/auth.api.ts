import { useAuth0 } from "@auth0/auth0-react";

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
          authorizationParams: {
            connection: "google-oauth2",
            redirect_uri: window.location.origin,
          },
        }),
    };
  },

  logout: () => {
    const { logout } = useAuth0();
    return {
      logout: () =>
        logout({ logoutParams: { returnTo: window.location.origin } }),
    };
  },
};
