import React from "react";
import { Typography, AppBar, Toolbar } from "@mcp-ui/core/ui";
import { Link } from "@tanstack/react-router";

export interface HeaderProps {
  title?: string;
  children?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
  title = "MCP UI",
  children,
}) => {
  return (
    <AppBar position="static">
      <Toolbar sx={{ justifyContent: "space-between" }}>
        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
          <Typography variant="h6" color="inherit">
            {title}
          </Typography>
        </Link>
        {children}
      </Toolbar>
    </AppBar>
  );
};
