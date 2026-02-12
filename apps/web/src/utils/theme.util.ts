import { useEffect } from "react";
import { ThemeName, THEME_MAP, useTheme } from "@mcp-ui/core";
import { useStorage } from "./storage.util";
import { Theme } from "@mui/material";

const THEME_STORAGE_KEY = "mcp-ui-theme";

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
