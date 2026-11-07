import React, { createContext, useContext, useMemo, useState } from "react";
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
  responsiveFontSizes,
  useTheme as useMuiTheme,
  type Palette,
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
  // The overrides read the resolved palette (the ring's primary, the
  // disabled colors), so build it once from the JSON first. A theme without
  // a primary gets MUI's default.
  const { palette } = createTheme(options);
  return responsiveFontSizes(createTheme(options, a11yComponents(palette)));
};

/** Width of the keyboard focus ring every theme draws (#797). */
export const FOCUS_RING_WIDTH = 2;

/** How an `aria-disabled` button looks (#793). */
const disabledLook = (action: Palette["action"]) => ({
  cursor: "not-allowed",
  color: action.disabled,
  boxShadow: "none",
  borderColor: action.disabledBackground,
});

/**
 * The accessibility overrides every theme gets, whatever its JSON says
 * (#797, WCAG 2.4.7 / 1.4.11 / 4.1.2):
 *
 * - a focus ring on every keyboard-focused control, in the palette's
 *   `primary.main`, which the contrast test holds at 3:1 or more against
 *   both backgrounds. MUI's ripple alone is too faint to see;
 * - the disabled look on an `aria-disabled` button, icon button or menu item
 *   (#793): a gated action, or a dialog's buttons while it saves. MUI's
 *   `disabled` would drop them from the tab order and block the tooltip that
 *   says why, so they're aria-disabled, and this is the one place that
 *   styles them;
 * - a name for every `CircularProgress`, so an unnamed spinner announces
 *   "Loading". A caller's own `aria-label` still wins.
 *
 * `createTheme(options, this)` deep-merges, so a JSON override for the same
 * component keeps its other keys. That's why every override here is an
 * object: a function-form `root` would replace the JSON's `root` outright.
 */
export function a11yComponents(palette: Palette): ThemeOptions {
  const { action } = palette;
  const ring = {
    outline: `${FOCUS_RING_WIDTH}px solid ${palette.primary.main}`,
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
      MuiButton: {
        styleOverrides: {
          root: {
            '&[aria-disabled="true"]': {
              ...disabledLook(action),
              "&:hover": disabledLook(action),
            },
            '&.MuiButton-contained[aria-disabled="true"]': {
              backgroundColor: action.disabledBackground,
              "&:hover": { backgroundColor: action.disabledBackground },
            },
            '&.MuiButton-outlined[aria-disabled="true"]:hover, &.MuiButton-text[aria-disabled="true"]:hover':
              { backgroundColor: "transparent" },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            '&[aria-disabled="true"]': {
              cursor: "not-allowed",
              color: action.disabled,
              "&:hover": { backgroundColor: "transparent" },
            },
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            '&[aria-disabled="true"]': {
              cursor: "not-allowed",
              opacity: action.disabledOpacity,
            },
          },
        },
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
