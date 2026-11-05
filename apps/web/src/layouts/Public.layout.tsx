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

import { MAIN_CONTENT_ID, SkipLinks } from "../components/SkipLinks.component";

export const PublicLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Box display="flex" flexDirection="column" height={"100vh"}>
      <SkipLinks />
      <AppBar position="static">
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
            <Typography variant="h3" component="span" color="inherit">
              Portals AI
            </Typography>
          </Link>
          <ButtonGroup>
            <ThemeSwitcher />
          </ButtonGroup>
        </Toolbar>
      </AppBar>
      <Box
        component="main"
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        flex={1}
        padding={3}
        overflow="auto"
        sx={{ "&:focus": { outline: "none" } }}
      >
        {children}
      </Box>
    </Box>
  );
};
