import React from "react";
import {
  BaseIconButton,
  Icon,
  IconName,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  type ThemeName,
} from "@mcp-ui/core";
import { usePersistedTheme } from "../utils";

export interface ThemeConfig {
  label: string;
  themeName: ThemeName;
  icon: IconName;
}

export interface ThemeSwitcherUIProps {
  currentThemeName: ThemeName;
  availableThemes: ThemeConfig[];
  onThemeSelect: (themeName: ThemeName) => void;
}

export const ThemeSwitcherUI: React.FC<ThemeSwitcherUIProps> = ({
  currentThemeName,
  availableThemes,
  onThemeSelect,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleThemeSelect = (themeName: ThemeName) => {
    onThemeSelect(themeName);
    handleClose();
  };

  const currentTheme = availableThemes.find(
    (theme) => theme.themeName === currentThemeName,
  );

  return (
    <>
      <BaseIconButton
        onClick={handleClick}
        color="inherit"
        aria-label="Select theme"
        aria-controls={open ? "theme-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        sx={(theme) => ({
          borderRadius: `${theme.shape.borderRadius}px`,
        })}
      >
        <Icon name={currentTheme?.icon || IconName.Sun} />
      </BaseIconButton>
      <Menu
        id="theme-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        {availableThemes.map((theme) => (
          <MenuItem
            key={theme.themeName}
            selected={theme.themeName === currentThemeName}
            onClick={() => handleThemeSelect(theme.themeName)}
          >
            <ListItemIcon>
              <Icon name={theme.icon} fontSize="small" />
            </ListItemIcon>
            <ListItemText>{theme.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

const DEFAULT_THEME_CONFIGS: ThemeConfig[] = [
  {
    label: "Light",
    themeName: "brand",
    icon: IconName.Sun,
  },
  {
    label: "Dark",
    themeName: "brand.dark",
    icon: IconName.Moon,
  },
];

export interface ThemeSwitcherProps {
  themeConfigs?: ThemeConfig[];
}

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
  themeConfigs = DEFAULT_THEME_CONFIGS,
}) => {
  const { themeName, setThemeName } = usePersistedTheme();

  return (
    <ThemeSwitcherUI
      currentThemeName={themeName}
      availableThemes={themeConfigs}
      onThemeSelect={setThemeName}
    />
  );
};
