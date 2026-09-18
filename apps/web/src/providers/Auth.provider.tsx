import React, { useCallback, useContext, useMemo } from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import {
  AuthProvider as OidcProvider,
  useAuth as useOidcAuth,
} from "react-oidc-context";

import {
  getRuntimeConfig,
  resolveAuth0Settings,
  resolveOidcSettings,
} from "../utils/runtime-config.util";
import {
  PRE_LOGIN_RETURN_TO_KEY,
  POST_LOGIN_RETURN_TO_KEY,
  takeReturnTo,
  stashReturnTo,
} from "../utils/post-login-return-to.util";

/**
 * Post-login `returnTo` bridge (#585), Auth0 path. On login we seed Auth0
 * `appState.returnTo` from the PRE key `Authorized` stashed; on the redirect
 * back, `onRedirectCallback` re-stashes it under the POST key that
 * `usePostLoginReturnTo` (in the router root) consumes to navigate. Auth0-only,
 * as #585 always was — the router is created inside this provider, so the
 * callback can't navigate directly. Residency OIDC login is IdP-hosted and out
 * of #585's scope.
 */
const auth0OnRedirectCallback = (appState?: { returnTo?: string }): void => {
  if (appState?.returnTo) {
    stashReturnTo(POST_LOGIN_RETURN_TO_KEY, appState.returnTo);
  }
};
const auth0ReturnToAppState = (): { returnTo?: string } => {
  const returnTo = takeReturnTo(PRE_LOGIN_RETURN_TO_KEY);
  return returnTo ? { returnTo } : {};
};

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
            appState: auth0ReturnToAppState(),
            authorizationParams: {
              connection: "google-oauth2",
              redirect_uri: window.location.origin,
            },
          }),
        withUniversal: () =>
          loginWithRedirect({
            openUrl,
            appState: auth0ReturnToAppState(),
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

/** Bridges `react-oidc-context` into the normalized `AuthContext` (residency). */
const OidcAuthBridge: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const oidc = useOidcAuth();

  const getToken = useCallback(async (): Promise<string> => {
    if (oidc.user?.access_token) {
      return oidc.user.access_token;
    }
    // Expired / not yet loaded — renew silently. A failure propagates so the
    // caller routes it through the 401→logout path, matching Auth0.
    const renewed = await oidc.signinSilent();
    if (renewed?.access_token) {
      return renewed.access_token;
    }
    throw new Error("Unable to acquire an access token");
  }, [oidc]);

  const value = useMemo<NormalizedAuth>(
    () => ({
      session: {
        user: oidc.user?.profile as AuthUser | undefined,
        isAuthenticated: oidc.isAuthenticated,
        isLoading: oidc.isLoading,
        error: oidc.error,
      },
      getToken,
      // Residency login is IdP-hosted: both entry points redirect to the
      // customer's issuer (no Google pin, no Auth0 Universal Login).
      login: {
        withGoogle: () => void oidc.signinRedirect(),
        withUniversal: () => void oidc.signinRedirect(),
      },
      logout: () => void oidc.signoutRedirect(),
    }),
    [oidc, getToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Selects the auth provider at runtime from `window.__RUNTIME_CONFIG__` (#566):
 * Auth0 (SaaS) or a generic OIDC client (residency). A residency build with
 * incomplete OIDC config **fails closed** (`resolveOidcSettings` throws) rather
 * than silently running against our Auth0 tenant or anonymous.
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
        onRedirectCallback={auth0OnRedirectCallback}
        cacheLocation="localstorage"
        useRefreshTokens={true}
      >
        <Auth0AuthBridge>{children}</Auth0AuthBridge>
      </Auth0Provider>
    );
  }

  // Residency: a config-driven generic OIDC client. `resolveOidcSettings`
  // throws on a blank field (fail-closed). PKCE public client (no secret).
  const settings = resolveOidcSettings(cfg);
  return (
    <OidcProvider
      authority={settings.issuer}
      client_id={settings.clientId}
      redirect_uri={window.location.origin}
      scope="openid profile email offline_access"
      extraQueryParams={{ audience: settings.audience }}
      automaticSilentRenew={true}
      onSigninCallback={() => {
        // Strip ?code=&state= from the URL after the code exchange so the
        // router doesn't see them; parity with Auth0's implicit callback.
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );
      }}
    >
      <OidcAuthBridge>{children}</OidcAuthBridge>
    </OidcProvider>
  );
};
