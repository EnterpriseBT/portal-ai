import { Navigate } from "@tanstack/react-router";
import { PublicLayout } from "../layouts/Public.layout";
import { LoadingView } from "../views/Loading.view";
import React from "react";
import { useAuth0 } from "@auth0/auth0-react";
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
  const auth = useAuth0();
  return (
    <AuthorizedUI loading={auth.isLoading} error={auth.error}>
      {!auth.isAuthenticated && <Navigate to="/login" />}
      {auth.isAuthenticated && children}
    </AuthorizedUI>
  );
};
