import React, { useCallback, useContext, useMemo } from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";

import {
  getRuntimeConfig,
  resolveAuth0Settings,
  RuntimeConfigError,
} from "../utils/runtime-config.util";

/**
 * Config-driven web auth (#607).
 *
 * One `useAuth()` seam normalizes whichever identity provider the runtime
 * config selects — Auth0 for SaaS, a generic OIDC client for residency (slice
 * 3) — so no consumer imports a vendor auth SDK. Each provider gets a *bridge*
 * that calls its own vendor hook and publishes a normalized value into
 * `AuthContext`; only one bridge mounts per deploy, so rules-of-hooks hold.
 */

/** The subset of an IdP profile the app reads. Both Auth0's `User` and an
 *  OIDC `user.profile` are structurally assignable to this. */
export interface AuthUser {
  name?: string;
  email?: string;
  picture?: string;
  sub?: string;
  [key: string]: unknown;
}

export interface AuthSession {
  user?: AuthUser;
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: Error;
}

export interface AuthLogin {
  /** SaaS: Google-pinned. Residency: the customer IdP's own login. */
  withGoogle: () => void;
  /** The guarded dev/E2E sign-in affordance (#304); Auth0 Universal Login. */
  withUniversal: () => void;
}

export interface NormalizedAuth {
  session: AuthSession;
  /** Access token for the API, audience baked in; renews as needed. */
  getToken: () => Promise<string>;
  login: AuthLogin;
  logout: () => void;
}

export const AuthContext = React.createContext<NormalizedAuth | null>(null);

/** Read the normalized auth; throws if used outside an `AuthProvider`. */
export const useAuth = (): NormalizedAuth => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
};

const openUrl = (url: string): void => window.location.replace(url);

/** Bridges `@auth0/auth0-react` into the normalized `AuthContext` (SaaS). */
const Auth0AuthBridge: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    getAccessTokenSilently,
    loginWithRedirect,
    logout,
  } = useAuth0();

  const getToken = useCallback(
    () =>
      getAccessTokenSilently({
        authorizationParams: { audience: resolveAuth0Settings().audience },
      }),
    [getAccessTokenSilently]
  );

  const value = useMemo<NormalizedAuth>(
    () => ({
      session: { user, isAuthenticated, isLoading, error },
      getToken,
      login: {
        withGoogle: () =>
          loginWithRedirect({
            openUrl,
            authorizationParams: {
              connection: "google-oauth2",
              redirect_uri: window.location.origin,
            },
          }),
        withUniversal: () =>
          loginWithRedirect({
            openUrl,
            authorizationParams: { redirect_uri: window.location.origin },
          }),
      },
      logout: () =>
        logout({
          logoutParams: { returnTo: window.location.origin },
          openUrl,
        }),
    }),
    [
      user,
      isAuthenticated,
      isLoading,
      error,
      getToken,
      loginWithRedirect,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Selects the auth provider at runtime from `window.__RUNTIME_CONFIG__` (#566):
 * Auth0 (SaaS) or a generic OIDC client (residency). The OIDC branch is wired
 * in slice 3; until then a residency build **fails closed** rather than
 * silently running against our Auth0 tenant.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const cfg = getRuntimeConfig();

  if (cfg.authProvider === "auth0") {
    const settings = resolveAuth0Settings();
    return (
      <Auth0Provider
        domain={settings.domain}
        clientId={settings.clientId}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: settings.audience,
        }}
        cacheLocation="localstorage"
        useRefreshTokens={true}
      >
        <Auth0AuthBridge>{children}</Auth0AuthBridge>
      </Auth0Provider>
    );
  }

  // Slice 3 replaces this with the react-oidc-context provider + bridge.
  throw new RuntimeConfigError(
    "OIDC auth provider is not yet available in this build"
  );
};
