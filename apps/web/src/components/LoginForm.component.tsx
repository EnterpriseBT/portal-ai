import React from "react";
import MuiLink from "@mui/material/Link";
import { sdk } from "../api/sdk";
import {
  getRuntimeConfig,
  resolveAuth0Settings,
  shouldShowQaLogin,
} from "../utils/runtime-config.util";
import {
  Box,
  Paper,
  Container,
  Stack,
  Divider,
  Typography,
  Button,
  Icon,
  IconName,
} from "@portalai/core/ui";

import { TERMS_URL, PRIVACY_URL } from "../utils/site-origin.util";

export interface LoginFormUIProps {
  onClickGoogleLogin: () => void;
  /** Dev/test-only E2E sign-in (#304). Rendered only when provided — the
   *  container supplies it solely under its dev guard, so it is absent for
   *  normal users and in production bundles. */
  onClickDevLogin?: () => void;
  /** QA sign-in for the deployed-env QA identity (#489). Rendered only when
   *  provided — the container supplies it only in builds that name a QA
   *  connection, and only on `?qa`. */
  onClickQaLogin?: () => void;
  /** Primary-button copy. Defaults to the SaaS Google label; a residency
   *  (OIDC) install passes a generic "Sign in" (#607). */
  primaryLabel?: string;
  /** Whether to show the Google icon on the primary button (SaaS only). */
  showProviderIcon?: boolean;
}

export const LoginFormUI: React.FC<LoginFormUIProps> = ({
  onClickGoogleLogin,
  onClickDevLogin,
  onClickQaLogin,
  primaryLabel = "Sign in with Google",
  showProviderIcon = true,
}) => {
  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: 4,
            width: "100%",
            borderRadius: 2,
          }}
        >
          <Stack spacing={3}>
            <Box sx={{ textAlign: "center" }}>
              <Typography variant="h4" component="h1" gutterBottom>
                Welcome to Portals AI
              </Typography>
            </Box>

            <Divider />

            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={onClickGoogleLogin}
              startIcon={
                showProviderIcon ? <Icon name={IconName.Google} /> : undefined
              }
              sx={{
                py: 1.5,
                textTransform: "none",
                fontSize: "1rem",
              }}
            >
              {primaryLabel}
            </Button>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: "center", mt: 2 }}
            >
              By continuing, you agree to our{" "}
              <MuiLink
                href={TERMS_URL}
                target="_blank"
                rel="noopener noreferrer"
                color="inherit"
                underline="always"
              >
                Terms of Service
              </MuiLink>{" "}
              and{" "}
              <MuiLink
                href={PRIVACY_URL}
                target="_blank"
                rel="noopener noreferrer"
                color="inherit"
                underline="always"
              >
                Privacy Policy
              </MuiLink>
            </Typography>

            {onClickDevLogin && (
              <Button
                variant="text"
                size="small"
                fullWidth
                onClick={onClickDevLogin}
                data-testid="e2e-dev-login"
                sx={{ textTransform: "none" }}
              >
                Dev sign-in (E2E)
              </Button>
            )}

            {onClickQaLogin && (
              <Button
                variant="text"
                size="small"
                fullWidth
                onClick={onClickQaLogin}
                data-testid="e2e-qa-login"
                sx={{ textTransform: "none" }}
              >
                QA sign-in
              </Button>
            )}
          </Stack>
        </Paper>
      </Box>
    </Container>
  );
};

export const LoginForm = () => {
  const { withGoogle, withUniversal, withQaConnection } = sdk.auth.login();
  // Residency (OIDC) login is IdP-hosted, not Google — use generic copy (#607).
  const isOidc = getRuntimeConfig().authProvider === "oidc";

  const handleGoogleLogin = () => {
    withGoogle();
  };

  // Dev/test-only sign-in for the E2E harness (#304). The app's normal login
  // is Google-only, which a headless test user can't drive; this guarded
  // affordance triggers Auth0 Universal Login (no pinned connection) so a
  // Database-connection test user can authenticate. Guarded twice: only in dev
  // builds (`import.meta.env.DEV` — stripped from production bundles) AND only
  // when explicitly requested via `?e2e`, so it never appears for normal users.
  const showDevLogin =
    !!import.meta.env?.DEV &&
    new URLSearchParams(window.location.search).has("e2e");

  // QA sign-in for the deployed-env QA identity (#489): only in builds that
  // name a QA connection, and only on `?qa`. See shouldShowQaLogin.
  const showQaLogin = shouldShowQaLogin({
    isOidc,
    qaConnection: resolveAuth0Settings().qaConnection,
    search: window.location.search,
  });

  return (
    <LoginFormUI
      onClickGoogleLogin={handleGoogleLogin}
      onClickDevLogin={showDevLogin ? () => withUniversal() : undefined}
      onClickQaLogin={showQaLogin ? () => withQaConnection() : undefined}
      primaryLabel={isOidc ? "Sign in" : "Sign in with Google"}
      showProviderIcon={!isOidc}
    />
  );
};
