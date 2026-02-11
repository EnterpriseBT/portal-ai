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
} from "@mcp-ui/core";
import { useAuth0 } from "@auth0/auth0-react";

export interface NavbarMenuUIProps {
  image?: string;
  label?: string;
  children?: React.ReactNode;
}

export const NavbarMenuUI: React.FC<NavbarMenuUIProps> = ({
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
        {label && <Typography variant="body2">{label}</Typography>}
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

export const NavbarMenu: React.FC = () => {
  const { user, logout } = useAuth0();
  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  return (
    <NavbarMenuUI image={user?.picture} label={user?.name}>
      <MenuItem onClick={handleLogout}>
        <ListItemIcon>
          <Icon name={IconName.Logout} fontSize="small" />
        </ListItemIcon>
        <ListItemText>Logout</ListItemText>
      </MenuItem>
    </NavbarMenuUI>
  );
};
