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
// The palette and typography augmentations (`palette.sheet`, #996). A module,
// not a bare .d.ts, so the build emits it and consumers of the theme see it.
import "../types/theme.js";
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
 * A `HighlightedCode` block (#799), marked `data-code-block`, styled from
 * `palette.code`: its background, its text and each highlight.js token
 * class. The block scrolls, so it's a focusable region, ringed inset (its
 * scroll container would clip an outside ring). The attribute twice
 * outranks the block's own `sx` whatever the injection order.
 */
export function codeBlockRules(
  palette: Palette,
  ring: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const code = palette.code;
  const block = "[data-code-block][data-code-block]";
  const tokens: [string, Record<string, unknown>][] = [
    ["keyword", { color: code.keyword }],
    ["built_in", { color: code.builtin }],
    ["type", { color: code.type }],
    ["title.class_", { color: code.type }],
    ["string", { color: code.string }],
    ["attribute", { color: code.string }],
    ["symbol", { color: code.string }],
    ["number", { color: code.number }],
    ["literal", { color: code.literal }],
    ["meta", { color: code.meta }],
    ["comment", { color: code.comment, fontStyle: "italic" }],
    ["doctag", { color: code.comment, fontStyle: "italic" }],
    ["quote", { color: code.comment, fontStyle: "italic" }],
    ["title.function_", { color: code.function }],
    ["attr", { color: code.attr }],
    ["property", { color: code.attr }],
    ["variable", { color: code.attr }],
  ];
  return {
    [block]: { backgroundColor: code.background, color: code.text },
    ...Object.fromEntries(
      tokens.map(([cls, style]) => [`${block} .hljs-${cls}`, style])
    ),
    [`${block} .hljs-class .hljs-keyword`]: { color: code.keyword },
    [`${block} .hljs-class .hljs-title`]: { color: code.type },
    [`${block} .hljs-function .hljs-title`]: { color: code.function },
    [`${block}:focus-visible`]: ring,
  };
}

/** A `[data-sheet-part]` selector, optionally narrowed to one `data-kind`. */
const part = (name: string, kind?: string) =>
  // The attribute twice: 0,2,0 outranks an sx or MUI root class (0,1,0)
  // whatever order the stylesheets were injected in.
  `[data-sheet-part][data-sheet-part="${name}"]${kind ? `[data-kind="${kind}"]` : ""}`;

const stripes = (color: string, band: number) =>
  `repeating-linear-gradient(45deg, ${color} 0 ${band}px, transparent ${band}px ${band * 2}px)`;

/**
 * The RegionEditor's sheet canvas, styled from `palette.sheet` (#996). The
 * canvas is plain DOM rendered by the thousand (virtualized cells), so it
 * marks each piece with `data-sheet-part` (and `data-kind` for overlay
 * kinds) and keeps only layout inline; every colour comes from here. A
 * region's entity colour, the one runtime value, arrives as the
 * `--region-color` custom property on its overlay.
 */
export function sheetCanvasRules(
  palette: Palette,
  ring: object
): Record<string, object> {
  const s = palette.sheet;
  // The JSONs are cast to ThemeOptions, so a theme missing its sheet palette
  // would otherwise render a canvas with no gridlines, headers or tints.
  if (!s) throw new Error("This theme has no palette.sheet (#996).");
  const grid = `1px solid ${s.gridLine}`;
  const header = {
    borderRight: grid,
    borderBottom: grid,
    color: s.headerText,
  };
  const rules: Record<string, object> = {
    [part("cell")]: {
      borderRight: grid,
      borderBottom: grid,
      '&[aria-busy="true"]': { color: s.placeholderText },
    },
    [part("header-row")]: { backgroundColor: s.headerBackground },
    [part("col-header")]: header,
    [part("row-header")]: { ...header, backgroundColor: s.headerBackground },
    [part("corner")]: {
      borderRight: grid,
      borderBottom: grid,
      backgroundColor: s.headerBackground,
    },
    [part("marquee")]: { backgroundColor: s.marquee },
    [part("region")]: {
      borderColor: "var(--region-color)",
      backgroundColor:
        "color-mix(in srgb, var(--region-color) 10%, transparent)",
      "&[data-selected]": {
        boxShadow:
          "0 0 0 2px color-mix(in srgb, var(--region-color) 50%, transparent)",
      },
    },
    [part("region-tab")]: {
      backgroundColor: "var(--region-color)",
      color: s.entityText,
    },
    // A region that extends past its bounds fades out in its colour.
    [part("region-extension")]: {
      borderColor: "var(--region-color)",
      "--region-fade":
        "color-mix(in srgb, var(--region-color) 20%, transparent)",
    },
    [`${part("region-extension")}[data-direction="down"]`]: {
      background:
        "linear-gradient(180deg, var(--region-fade) 0%, transparent 100%)",
    },
    [`${part("region-extension")}[data-direction="right"]`]: {
      background:
        "linear-gradient(90deg, var(--region-fade) 0%, transparent 100%)",
    },
    // The legend's and Review step's entity dots, and the legend's chip.
    [part("entity-dot")]: { backgroundColor: "var(--region-color)" },
    [`${part("entity-chip")}[data-selected]`]: {
      borderColor: "var(--region-color)",
      backgroundColor:
        "color-mix(in srgb, var(--region-color) 8%, transparent)",
    },
    [part("confidence-dot")]: { backgroundColor: "var(--confidence-color)" },
    [part("confidence-chip")]: {
      borderColor: "var(--confidence-color)",
      backgroundColor:
        "color-mix(in srgb, var(--confidence-color) 10%, transparent)",
    },
    [`${part("drift-banner")}[data-severity="blocker"]`]: {
      backgroundColor: s.drift.blocker,
    },
    [`${part("drift-banner")}:not([data-severity="blocker"])`]: {
      backgroundColor: s.drift.warn,
    },
    [part("region-badge")]: {
      backgroundColor: s.badgeBackground,
      color: "var(--region-color)",
    },
    [part("handle")]: {
      backgroundColor: s.handleBackground,
      borderColor: "var(--region-color)",
    },
    [part("deco-chip")]: {
      backgroundColor: s.labelBackground,
      color: palette.text.primary,
    },
    [part("anchor-icon")]: { color: s.anchorIcon },
    [part("decoration", "skipped")]: {
      backgroundImage: stripes(s.decoration.skippedStripe, 6),
    },
    // The configuration panel's legend swatch: the same tint, finer stripes.
    [`${part("decoration", "skipped")}[data-swatch]`]: {
      backgroundImage: stripes(s.decoration.skippedStripe, 3),
    },
    // The panel's per-intersection notes mirror the canvas's pivot × pivot
    // block: its tint, its outline.
    [part("intersection-note")]: {
      backgroundColor: s.intersection.pivotPivot.fill,
      borderColor: s.intersection.pivotPivot.border,
    },
    [part("segment", "skip")]: {
      backgroundImage: stripes(s.segment.skipStripe, 5),
    },
    [part("intersection", "skip-mixed")]: {
      backgroundImage: stripes(s.intersection.skipStripe, 5),
    },
    [`${part("intersection")}[data-editable]:hover, ${part("intersection")}[data-editable]:focus-visible`]:
      { backgroundColor: s.intersection.hover },
    // An editable intersection is a button: the same inset ring as a cell.
    [`${part("intersection")}[data-editable]:focus-visible`]: ring,
    [part("divider-tint")]: { backgroundColor: s.divider.rest },
    [`${part("divider")}:hover > ${part("divider-tint")}, ${part("divider")}:focus-visible > ${part("divider-tint")}`]:
      { backgroundColor: s.divider.active },
  };
  for (const [kind, fill] of Object.entries(s.decoration)) {
    if (kind === "skippedStripe") continue;
    rules[part("decoration", kind)] = {
      ...rules[part("decoration", kind)],
      backgroundColor: fill,
    };
  }
  const overlays = {
    segment: {
      field: s.segment.field,
      pivot: s.segment.pivot,
      skip: s.segment.skip,
    },
    intersection: {
      "field-field": s.intersection.fieldField,
      "field-pivot": s.intersection.fieldPivot,
      "pivot-pivot": s.intersection.pivotPivot,
      "skip-mixed": s.intersection.skipMixed,
    },
  };
  for (const [name, kinds] of Object.entries(overlays)) {
    for (const [kind, c] of Object.entries(kinds)) {
      rules[part(name, kind)] = {
        ...rules[part(name, kind)],
        backgroundColor: c.fill,
        borderColor: c.border,
      };
      rules[part(`${name}-chip`, kind)] = {
        backgroundColor: c.chip,
        color: s.chipText,
      };
    }
  }
  // Entity slots and confidence bands set the colour their parts read.
  s.entities.forEach((colour, slot) => {
    rules[`[data-entity="${slot}"]`] = { "--region-color": colour };
  });
  rules['[data-entity="none"]'] = { "--region-color": s.entityFallback };
  for (const [band, colour] of Object.entries(s.confidence)) {
    rules[`[data-confidence="${band}"]`] = { "--confidence-color": colour };
  }
  return rules;
}

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
      // A grid cell that isn't an MUI control (the region editor's sheet,
      // #795) rings the same way. Inset, so the cell's neighbours and the
      // sticky headers can't hide it.
      MuiCssBaseline: {
        styleOverrides: {
          '[role="gridcell"]:focus-visible': {
            ...ring,
            outlineOffset: -FOCUS_RING_WIDTH,
          },
          ...sheetCanvasRules(palette, {
            ...ring,
            outlineOffset: -FOCUS_RING_WIDTH,
          }),
          ...codeBlockRules(palette, {
            ...ring,
            outlineOffset: -FOCUS_RING_WIDTH,
          }),
        },
      },
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
