import React, { StrictMode, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeName, ThemeProvider } from "@portalai/core/ui";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";

import "@portalai/core/styles";
import { queryClient } from "../client";
import { useStorage, registerAuthLogout } from "../utils";
import {
  POST_LOGIN_RETURN_TO_KEY,
  stashReturnTo,
} from "../utils/post-login-return-to.util";
import { LayoutProvider } from "./Layout.provider";
import { ToastProvider } from "./Toast.provider";

/**
 * After Auth0 completes a login, stash the transaction's `returnTo` (set from
 * `appState` on the login call) for the in-router bridge to consume (#585). The
 * router is created inside this provider, so navigating here isn't possible —
 * `usePostLoginReturnTo` (mounted in the root route) does the navigation.
 */
const onRedirectCallback = (appState?: { returnTo?: string }) => {
  if (appState?.returnTo) {
    stashReturnTo(POST_LOGIN_RETURN_TO_KEY, appState.returnTo);
  }
};

const AuthErrorHandler: React.FC = () => {
  const { logout } = useAuth0();

  useEffect(() => {
    registerAuthLogout(() =>
      logout({ logoutParams: { returnTo: window.location.origin } })
    );
  }, [logout]);

  return null;
};

export interface ApplicationProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeName;
}

export const ApplicationProvider: React.FC<ApplicationProviderProps> = ({
  children,
  defaultTheme = "brand",
}) => {
  const { value: theme } = useStorage<ThemeName>({
    key: "portalai-theme",
    defaultValue: defaultTheme,
    storageType: "local",
  });

  return (
    <StrictMode>
      <Auth0Provider
        domain={import.meta.env.VITE_AUTH0_DOMAIN}
        clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        }}
        onRedirectCallback={onRedirectCallback}
        cacheLocation="localstorage"
        useRefreshTokens={true}
      >
        <AuthErrorHandler />
        <ThemeProvider defaultTheme={theme}>
          <LayoutProvider>
            <QueryClientProvider client={queryClient}>
              {/* Inside ThemeProvider so toasts are themed, and outside the
                  RouterProvider that `Application.tsx` mounts within this
                  chain — so a toast raised just before a navigation survives
                  the route change (#293). */}
              <ToastProvider>{children}</ToastProvider>
            </QueryClientProvider>
          </LayoutProvider>
        </ThemeProvider>
      </Auth0Provider>
    </StrictMode>
  );
};
