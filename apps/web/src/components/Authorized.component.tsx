import { Navigate, useNavigate, useRouterState } from "@tanstack/react-router";
import React, { useEffect } from "react";

import { PublicLayout } from "../layouts/Public.layout";
import { LoadingView } from "../views/Loading.view";
import { sdk } from "../api/sdk";
import { handleAuthError } from "../utils/auth-error.util";
import {
  stashReturnTo,
  takeReturnTo,
  useReturnTo,
  PRE_LOGIN_RETURN_TO_KEY,
  POST_LOGIN_RETURN_TO_KEY,
} from "../utils/post-login-return-to.util";

export interface AuthorizedPageUIProps {
  loading: boolean;
  error?: Error;
  children: React.ReactNode;
}

export const AuthorizedUI: React.FC<AuthorizedPageUIProps> = ({
  loading,
  error,
  children,
}) => {
  if (loading) {
    return (
      <PublicLayout>
        <LoadingView />
      </PublicLayout>
    );
  }

  if (error) {
    handleAuthError();
    return (
      <PublicLayout>
        <LoadingView />
      </PublicLayout>
    );
  }

  return <>{children}</>;
};

export const Authorized: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isLoading, error, isAuthenticated } = sdk.auth.session();
  const href = useRouterState({ select: (s) => s.location.href });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const routerIdle = useRouterState({ select: (s) => s.status === "idle" });
  const navigate = useNavigate();

  // Back from login (#884): the Auth0 callback stashed where the user was
  // headed before auth settled. While that target is pending the route stays
  // held back, so the page Auth0 landed on (the dashboard at "/") never mounts
  // and fires its self-provisioning requests. Navigate there, and release the
  // target once the router is idle on it (it updates the location before it
  // swaps the matched route).
  const stashed = useReturnTo(POST_LOGIN_RETURN_TO_KEY);
  const pendingReturnTo = !isLoading && isAuthenticated ? stashed : null;
  useEffect(() => {
    if (!pendingReturnTo) return;
    // Resolved against our own origin and used as path + search only, so a
    // stashed value can never leave the app.
    const url = new URL(pendingReturnTo, window.location.origin);
    if (pathname === url.pathname) {
      if (routerIdle) takeReturnTo(POST_LOGIN_RETURN_TO_KEY);
      return;
    }
    navigate({
      to: url.pathname,
      search: Object.fromEntries(url.searchParams.entries()),
      replace: true,
    });
  }, [pendingReturnTo, pathname, routerIdle, navigate]);

  // Remember where the user was headed so login can return them there (#585) —
  // the invite accept link is the motivating case (logged-out invitee → login →
  // back to /invitations/accept?token=…). Read by LoginForm at login time.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      stashReturnTo(PRE_LOGIN_RETURN_TO_KEY, href);
    }
  }, [isLoading, isAuthenticated, href]);

  return (
    <AuthorizedUI loading={isLoading || !!pendingReturnTo} error={error}>
      {/* search must survive this redirect: the guarded dev-login affordance
          (#304) is addressed as /?e2e=1 and lands here unauthenticated. */}
      {!isAuthenticated && <Navigate to="/login" search={true} />}
      {isAuthenticated && children}
    </AuthorizedUI>
  );
};
