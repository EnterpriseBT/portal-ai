import React, { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { ThemeName, ThemeProvider } from "@mcp-ui/core";
import { Auth0Provider } from "@auth0/auth0-react";

import "@mcp-ui/core/styles";
import { queryClient } from "./client";

export interface AppProviderProps {
  defaultTheme: ThemeName;
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({
  children,
  defaultTheme = "brand",
}) => {
  return (
    <StrictMode>
      <Auth0Provider
        domain={import.meta.env.VITE_AUTH0_DOMAIN}
        clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
        authorizationParams={{ redirect_uri: window.location.origin }}
        cacheLocation="localstorage"
        useRefreshTokens={true}
      >
        <ThemeProvider defaultTheme={defaultTheme}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </ThemeProvider>
      </Auth0Provider>
    </StrictMode>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider defaultTheme="brand">
      <RouterProvider router={router} />
    </AppProvider>
  );
};
