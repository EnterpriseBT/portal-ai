import { Navigate, useRouterState } from "@tanstack/react-router";
import React, { useEffect } from "react";

import { PublicLayout } from "../layouts/Public.layout";
import { LoadingView } from "../views/Loading.view";
import { sdk } from "../api/sdk";
import { handleAuthError } from "../utils/auth-error.util";
import {
  stashReturnTo,
  PRE_LOGIN_RETURN_TO_KEY,
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

  // Remember where the user was headed so login can return them there (#585) —
  // the invite accept link is the motivating case (logged-out invitee → login →
  // back to /invitations/accept?token=…). Read by LoginForm at login time.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      stashReturnTo(PRE_LOGIN_RETURN_TO_KEY, href);
    }
  }, [isLoading, isAuthenticated, href]);

  return (
    <AuthorizedUI loading={isLoading} error={error}>
      {/* search must survive this redirect: the guarded dev-login affordance
          (#304) is addressed as /?e2e=1 and lands here unauthenticated. */}
      {!isAuthenticated && <Navigate to="/login" search={true} />}
      {isAuthenticated && children}
    </AuthorizedUI>
  );
};
