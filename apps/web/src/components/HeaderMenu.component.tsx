import React, { useState } from "react";
import {
  Avatar,
  Menu,
  MenuItem,
  BaseIconButton,
  ListItemIcon,
  ListItemText,
  Icon,
  IconName,
  Typography,
  Divider,
} from "@portalai/core/ui";
import { sdk } from "../api/sdk";
import { Link } from "@tanstack/react-router";

export interface HeaderMenuUIProps {
  image?: string;
  label?: string;
  children?: React.ReactNode;
}

export const HeaderMenuUI: React.FC<HeaderMenuUIProps> = ({
  image,
  label,
  children,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <BaseIconButton
        color="inherit"
        onClick={handleClick}
        size="small"
        aria-label="account menu"
        aria-controls={open ? "account-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        sx={(theme) => ({
          display: "flex",
          gap: 1,
          alignItems: "center",
          borderRadius: `${theme.shape.borderRadius}px`,
        })}
      >
        {label && (
          <Typography
            variant="body2"
            sx={{ display: { xs: "none", sm: "block" } }}
          >
            {label}
          </Typography>
        )}
        <Avatar
          src={image}
          alt={label || "User"}
          sx={{ width: 32, height: 32 }}
        >
          {!image && <Icon name={IconName.Person} />}
        </Avatar>
      </BaseIconButton>
      <Menu
        id="account-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        {children}
      </Menu>
    </>
  );
};

export const HeaderMenu: React.FC = () => {
  const { user } = sdk.auth.session();
  const { data: currentOrganizationPayload } = sdk.organizations.current();
  const { logout } = sdk.auth.logout();
  const handleLogout = () => {
    logout();
  };

  return (
    <HeaderMenuUI image={user?.picture} label={user?.name}>
      <Typography
        variant="subtitle2"
        sx={(theme) => ({
          color: theme.palette.text.secondary,
          padding: theme.spacing(1, 2),
        })}
      >
        {currentOrganizationPayload?.organization.name}
      </Typography>
      <Divider />
      <MenuItem component={Link} to="/settings">
        <ListItemIcon>
          <Icon name={IconName.Settings} fontSize="small" />
        </ListItemIcon>
        <ListItemText>Settings</ListItemText>
      </MenuItem>
      <MenuItem component={Link} to="/help">
        <ListItemIcon>
          <Icon name={IconName.HelpOutline} fontSize="small" />
        </ListItemIcon>
        <ListItemText>Help</ListItemText>
      </MenuItem>
      <MenuItem onClick={handleLogout}>
        <ListItemIcon>
          <Icon name={IconName.Logout} fontSize="small" />
        </ListItemIcon>
        <ListItemText>Logout</ListItemText>
      </MenuItem>
    </HeaderMenuUI>
  );
};
