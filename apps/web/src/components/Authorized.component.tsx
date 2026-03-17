import { Navigate } from "@tanstack/react-router";
import React from "react";

import { PublicLayout } from "../layouts/Public.layout";
import { LoadingView } from "../views/Loading.view";
import { sdk } from "../api/sdk";
import { handleAuthError } from "../utils/auth-error.util";

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
  return (
    <AuthorizedUI loading={isLoading} error={error}>
      {!isAuthenticated && <Navigate to="/login" />}
      {isAuthenticated && children}
    </AuthorizedUI>
  );
};
