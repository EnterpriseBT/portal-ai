import React, { createContext, useContext, useMemo, useState } from "react";
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
  responsiveFontSizes,
  useTheme as useMuiTheme,
  type Theme,
  type ThemeOptions,
} from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import brandTheme from "../assets/themes/brand-theme.json" with { type: "json" };
import brandDarkTheme from "../assets/themes/brand-theme-dark.json" with { type: "json" };

/**
 * Wrap `createTheme` with `responsiveFontSizes` so every typography variant
 * (h1–h6, body, etc.) scales down on smaller breakpoints automatically. This
 * means components can use `variant="h1"` / `variant="h2"` without redefining
 * responsive `fontSize` rules at every call site — the theme owns the scale.
 */
const buildTheme = (options: ThemeOptions): Theme => {
  const base = createTheme(options);
  return responsiveFontSizes(createTheme(options, a11yComponents(base)));
};

/** Width of the keyboard focus ring every theme draws (#797). */
export const FOCUS_RING_WIDTH = 2;

/**
 * The accessibility overrides every theme gets, whatever its JSON says
 * (#797, WCAG 2.4.7 / 1.4.11 / 4.1.2):
 *
 * - a focus ring on every keyboard-focused control, in `primary.main`, which
 *   the contrast test holds at 3:1 or more against both backgrounds. MUI's
 *   ripple alone is too faint to see;
 * - a name for every `CircularProgress`, so an unnamed spinner announces
 *   "Loading". A caller's own `aria-label` still wins.
 *
 * `createTheme(options, this)` deep-merges, so a JSON override for the same
 * component keeps its other keys.
 */
export function a11yComponents(theme: Theme): ThemeOptions {
  const ring = {
    outline: `${FOCUS_RING_WIDTH}px solid ${theme.palette.primary.main}`,
    outlineOffset: 2,
  };
  return {
    components: {
      MuiButtonBase: {
        styleOverrides: { root: { "&.Mui-focusVisible": ring } },
      },
      MuiLink: {
        styleOverrides: { root: { "&:focus-visible": ring } },
      },
      MuiCircularProgress: {
        defaultProps: { "aria-label": "Loading" },
      },
      MuiLinearProgress: {
        defaultProps: { "aria-label": "Progress" },
      },
    },
  };
}

export const THEME_MAP = {
  brand: buildTheme(brandTheme as ThemeOptions),
  "brand.dark": buildTheme(brandDarkTheme as ThemeOptions),
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
