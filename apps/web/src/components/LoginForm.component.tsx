import React from "react";
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
} from "@mcp-ui/core/ui";

export interface LoginFormUIProps {
  onClickGoogleLogin: () => void;
}

export const LoginFormUI: React.FC<LoginFormUIProps> = ({
  onClickGoogleLogin,
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
                Welcome
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Sign in to continue
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
              Continue with Google
            </Button>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: "center", mt: 2 }}
            >
              By continuing, you agree to our Terms of Service and Privacy
              Policy
            </Typography>
          </Stack>
        </Paper>
      </Box>
    </Container>
  );
};

export const LoginForm = () => {
  const { withGoogle } = sdk.auth.login();

  const handleGoogleLogin = () => {
    withGoogle();
  };

  return <LoginFormUI onClickGoogleLogin={handleGoogleLogin} />;
};
