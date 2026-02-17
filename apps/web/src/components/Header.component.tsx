import React from "react";
import { Typography, AppBar, Toolbar } from "@mcp-ui/core/ui";

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
        <Typography variant="h4" color="inherit">
          {title}
        </Typography>
        {children}
      </Toolbar>
    </AppBar>
  );
};
