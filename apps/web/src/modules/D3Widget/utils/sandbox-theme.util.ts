import type { Theme } from "@mui/material/styles";

import { THEME_MAP } from "@portalai/core/ui";

/**
 * The serializable theme tokens handed to a sandboxed D3 program as
 * `api.theme` (#268). The iframe cannot inherit MUI context — these
 * cross the postMessage bridge, so the shape must stay plain JSON.
 */
/** stroke-dasharray values that tell lines apart (#1022); the first is solid. */
export const SANDBOX_DASHES = ["none", "6 3", "2 3", "8 3 2 3", "1 3", "12 4"];

/** d3 symbol types that tell markers apart (#1022), as `api.d3[name]`. */
export const SANDBOX_SYMBOLS = [
  "symbolCircle",
  "symbolSquare",
  "symbolTriangle",
  "symbolDiamond",
  "symbolCross",
  "symbolStar",
  "symbolWye",
];

export interface D3SandboxTheme {
  mode: "light" | "dark";
  /** The figure's surface (`background.paper`), which the frame paints, so
   *  the palette's 3:1 is measured against what the chart is drawn on. */
  background: string;
  text: string;
  fontFamily: string;
  monospaceFontFamily: string;
  /** `palette.dataViz.categorical` (#1022): the only colours a series may
   *  use, in order. Held at 3:1 by core's `theme-contrast.test.ts`. */
  categorical: string[];
  /** Dash patterns for lines, so series differ by more than colour. */
  dashes: string[];
  /** d3 symbol names for markers, so series differ by more than colour. */
  symbols: string[];
}

/** The brand themes register a custom `typography.monospace` variant. */
interface MonospaceTypography {
  monospace?: { fontFamily?: string };
}

export function buildSandboxTheme(theme: Theme): D3SandboxTheme {
  const { palette, typography } = theme;
  return {
    mode: palette.mode,
    background: palette.background.paper,
    text: palette.text.primary,
    fontFamily: typography.fontFamily ?? "sans-serif",
    monospaceFontFamily:
      (typography as unknown as MonospaceTypography).monospace?.fontFamily ??
      "monospace",
    // A theme built without `dataViz` (a bare `createTheme`) falls back to
    // the brand palette for its mode, as MapWidgetUI does, rather than throw.
    categorical: [
      ...(
        palette.dataViz ??
        THEME_MAP[palette.mode === "dark" ? "brand.dark" : "brand"].palette
          .dataViz
      ).categorical,
    ],
    dashes: [...SANDBOX_DASHES],
    symbols: [...SANDBOX_SYMBOLS],
  };
}
