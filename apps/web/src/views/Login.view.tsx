import { LoginForm } from "../components/LoginForm.component";
import { Box } from "@mcp-ui/core/ui";

export const LoginView = () => {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <LoginForm />
    </Box>
  );
};
