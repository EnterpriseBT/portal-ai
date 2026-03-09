import React, { createContext, useContext, useMemo, useState } from "react";
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
  useTheme as useMuiTheme,
  type ThemeOptions,
} from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import brandTheme from "../assets/themes/brand-theme.json" with { type: "json" };
import brandDarkTheme from "../assets/themes/brand-theme-dark.json" with { type: "json" };

export const THEME_MAP = {
  brand: createTheme(brandTheme as ThemeOptions),
  "brand.dark": createTheme(brandDarkTheme as ThemeOptions),
};

export type ThemeName = keyof typeof THEME_MAP;
export type ThemeMode = "light" | "dark";

export const DEFAULT_THEME: ThemeName = "brand";

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeName;
}

export interface ThemeApi {
  themeName: ThemeName;
  setThemeName: (themeName: ThemeName) => void;
}

export const ThemeContext = createContext<ThemeApi>({} as ThemeApi);

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultTheme,
}) => {
  const [themeName, setThemeName] = useState(defaultTheme ?? DEFAULT_THEME);

  const theme = THEME_MAP[themeName];

  const themeApi: ThemeApi = useMemo(
    () => ({
      themeName,
      setThemeName,
    }),
    [themeName]
  );

  return (
    <ThemeContext.Provider value={themeApi}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const themeApi = useContext(ThemeContext);
  const theme = useMuiTheme();
  return {
    ...themeApi,
    theme,
  };
};
