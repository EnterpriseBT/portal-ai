import { useEffect } from "react";
import { Theme } from "@mui/material";

import { THEME_STORAGE_KEY } from "@portalai/core/constants";
import { ThemeName, THEME_MAP, useTheme } from "@portalai/core/ui";

import { useStorage } from "./storage.util";

/**
 * Type guard to validate if a value is a valid ThemeName
 */
const isValidThemeName = (value: unknown): value is ThemeName => {
  return typeof value === "string" && value in THEME_MAP;
};

export interface UsePersistedThemeResult {
  themeName: ThemeName;
  setThemeName: (theme: ThemeName) => void;
  theme: Theme;
}

/**
 * Custom hook to manage theme persistence in localStorage
 * Syncs the ThemeProvider's theme to localStorage automatically
 * Must be used inside ThemeProvider
 * @returns The current theme and a setter function from ThemeProvider
 */
export const usePersistedTheme = (): UsePersistedThemeResult => {
  // Get theme from ThemeProvider
  const { themeName, setThemeName, theme } = useTheme();

  const { setValue: setPersistedTheme } = useStorage<ThemeName>({
    key: THEME_STORAGE_KEY,
    defaultValue: themeName,
    storageType: "local",
    validator: isValidThemeName,
  });

  // Sync provider theme to localStorage
  useEffect(() => {
    setPersistedTheme(themeName);
  }, [themeName, setPersistedTheme]);

  return {
    themeName,
    setThemeName,
    theme,
  };
};
