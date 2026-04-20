import React from "react";
import { ThemeSwitcher } from "../components/ThemeSwitcher.component";
import {
  AppBar,
  Box,
  ButtonGroup,
  Toolbar,
  Typography,
} from "@portalai/core/ui";
import { Link } from "@tanstack/react-router";

export const PublicLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
      <AppBar position="static">
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
            <Typography variant="h3" color="inherit">
              Portals.ai
            </Typography>
          </Link>
          <ButtonGroup>
            <ThemeSwitcher />
          </ButtonGroup>
        </Toolbar>
      </AppBar>
      <Box flex={1} padding={3} overflow="auto">
        {children}
      </Box>
    </Box>
  );
};
