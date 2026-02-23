import { Navigate } from "@tanstack/react-router";
import { PublicLayout } from "../layouts/Public.layout";
import { LoadingView } from "../views/Loading.view";
import React from "react";
import { sdk } from "../api/sdk";
import { BadRequestView } from "../views/BadRequest.view";

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
    return (
      <PublicLayout>
        <BadRequestView description="Unable to process your request" />
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
