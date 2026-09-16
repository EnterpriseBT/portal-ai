import React from "react";
import MuiLink from "@mui/material/Link";
import { sdk } from "../api/sdk";
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
import { resolveDeployMode } from "../utils/deploy-mode.util";
import {
  takeReturnTo,
  PRE_LOGIN_RETURN_TO_KEY,
} from "../utils/post-login-return-to.util";

export interface LoginFormUIProps {
  /** The primary sign-in action. Named for the SaaS default (Google), but the
   *  container may wire it to Universal Login under self-hosted (#577). */
  onClickGoogleLogin: () => void;
  /** Primary button label. Defaults to "Sign in with Google" (SaaS); the
   *  self-hosted container passes a generic label (#577). */
  primaryLabel?: string;
  /** Whether to show the Google icon on the primary button. Default true
   *  (SaaS); false under self-hosted, where login isn't Google (#577). */
  showGoogleIcon?: boolean;
  /** Dev/test-only E2E sign-in (#304). Rendered only when provided — the
   *  container supplies it solely under its dev guard, so it is absent for
   *  normal users and in production bundles. */
  onClickDevLogin?: () => void;
}

export const LoginFormUI: React.FC<LoginFormUIProps> = ({
  onClickGoogleLogin,
  primaryLabel = "Sign in with Google",
  showGoogleIcon = true,
  onClickDevLogin,
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
                showGoogleIcon ? <Icon name={IconName.Google} /> : undefined
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
          </Stack>
        </Paper>
      </Box>
    </Container>
  );
};

export const LoginForm = () => {
  const { withGoogle, withUniversal } = sdk.auth.login();
  // #577: self-hosted installs authenticate against the customer's own IdP via
  // Auth0 Universal Login (no Google pin); SaaS keeps the one-click Google
  // button. Read at build time, defaulting to saas.
  const selfHosted =
    resolveDeployMode(import.meta.env.VITE_DEPLOY_MODE) === "self_hosted";

  const handleGoogleLogin = () => {
    if (selfHosted) {
      withUniversal();
      return;
    }
    // `Authorized` stashed the path the invitee was headed for; carry it through
    // login so they return to their accept link afterwards (#585).
    withGoogle(takeReturnTo(PRE_LOGIN_RETURN_TO_KEY) ?? undefined);
  };

  // Dev/test-only sign-in for the E2E harness (#304). The app's normal login
  // is Google-only, which a headless test user can't drive; this guarded
  // affordance triggers Auth0 Universal Login (no pinned connection) so a
  // Database-connection test user can authenticate. Guarded twice: only in dev
  // builds (`import.meta.env.DEV` — stripped from production bundles) AND only
  // when explicitly requested via `?e2e`, so it never appears for normal users.
  const showDevLogin =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("e2e");

  return (
    <LoginFormUI
      onClickGoogleLogin={handleGoogleLogin}
      primaryLabel={selfHosted ? "Sign in with SSO" : undefined}
      showGoogleIcon={!selfHosted}
      onClickDevLogin={showDevLogin ? () => withUniversal() : undefined}
    />
  );
};
