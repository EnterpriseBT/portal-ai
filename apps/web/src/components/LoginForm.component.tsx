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

export interface LoginFormUIProps {
  onClickGoogleLogin: () => void;
  /** Dev/test-only E2E sign-in (#304). Rendered only when provided — the
   *  container supplies it solely under its dev guard, so it is absent for
   *  normal users and in production bundles. */
  onClickDevLogin?: () => void;
}

export const LoginFormUI: React.FC<LoginFormUIProps> = ({
  onClickGoogleLogin,
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
              startIcon={<Icon name={IconName.Google} />}
              sx={{
                py: 1.5,
                textTransform: "none",
                fontSize: "1rem",
              }}
            >
              Sign in with Google
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
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("e2e");

  return (
    <LoginFormUI
      onClickGoogleLogin={handleGoogleLogin}
      onClickDevLogin={showDevLogin ? () => withUniversal() : undefined}
    />
  );
};
