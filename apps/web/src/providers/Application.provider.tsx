import React, { StrictMode, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeName, ThemeProvider } from "@portalai/core/ui";

import "@portalai/core/styles";
import { queryClient } from "../client";
import { useStorage, registerAuthLogout } from "../utils";
import { useRateLimitNotice } from "../utils/use-rate-limit-notice.util";
import { AuthProvider, useAuth } from "./Auth.provider";
import { LayoutProvider } from "./Layout.provider";
import { ToastProvider } from "./Toast.provider";

const AuthErrorHandler: React.FC = () => {
  const { logout } = useAuth();

  useEffect(() => {
    registerAuthLogout(() => logout());
  }, [logout]);

  return null;
};

/** #747: one notice per API rate-limit window, on every page. Inside
 *  `ToastProvider`, so it can raise one. */
const RateLimitNotice: React.FC = () => {
  useRateLimitNotice();
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
      {/* AuthProvider selects Auth0 (SaaS) or a generic OIDC client (residency)
          at runtime from window.__RUNTIME_CONFIG__ (#607). */}
      <AuthProvider>
        <AuthErrorHandler />
        <ThemeProvider defaultTheme={theme}>
          <LayoutProvider>
            <QueryClientProvider client={queryClient}>
              {/* Inside ThemeProvider so toasts are themed, and outside the
                  RouterProvider that `Application.tsx` mounts within this
                  chain — so a toast raised just before a navigation survives
                  the route change (#293). */}
              <ToastProvider>
                <RateLimitNotice />
                {children}
              </ToastProvider>
            </QueryClientProvider>
          </LayoutProvider>
        </ThemeProvider>
      </AuthProvider>
    </StrictMode>
  );
};
