import type { CSSProperties } from "react";
import type { PaletteColor, PaletteColorOptions } from "@mui/material/styles";
import type {} from "@mui/material/Typography";
import type {} from "@mui/material/IconButton";

/** One overlay kind on the sheet canvas: its tint, its outline, and the
 *  opaque fill its chip's text sits on (#996). */
export interface SheetOverlayColors {
  fill: string;
  border: string;
  chip: string;
}

/**
 * The RegionEditor's sheet canvas (#996). The canvas renders through
 * `MuiCssBaseline` rules keyed by `data-sheet-part` (see `a11yComponents`),
 * so every colour on it lives here, in both theme JSONs.
 */
export interface SheetPalette {
  gridLine: string;
  headerBackground: string;
  headerText: string;
  placeholderText: string;
  marquee: string;
  labelBackground: string;
  badgeBackground: string;
  chipText: string;
  handleBackground: string;
  anchorIcon: string;
  decoration: {
    header: string;
    rowAxisLabel: string;
    colAxisLabel: string;
    axisNameAnchor: string;
    cellValue: string;
    skipped: string;
    skippedStripe: string;
  };
  segment: {
    field: SheetOverlayColors;
    pivot: SheetOverlayColors;
    skip: SheetOverlayColors;
    skipStripe: string;
  };
  intersection: {
    fieldField: SheetOverlayColors;
    fieldPivot: SheetOverlayColors;
    pivotPivot: SheetOverlayColors;
    skipMixed: SheetOverlayColors;
    hover: string;
    skipStripe: string;
  };
  divider: { rest: string; active: string };
  /** One colour per entity slot (`data-entity="0"`…), mode-specific: light
   *  tones carry white tab text, dark tones dark text. */
  entities: string[];
  /** A region with no entity, or one past the palette's end. */
  entityFallback: string;
  /** Tab text on an entity colour. */
  entityText: string;
  confidence: { green: string; yellow: string; red: string; none: string };
  drift: { blocker: string; warn: string };
}

/**
 * Syntax-highlight colours for `HighlightedCode` (#799). `background` is
 * opaque, so each token's contrast against it is fixed; every token and
 * `text` is AA (4.5:1) on it in both themes (`theme-contrast.test.ts`).
 */
export interface CodePalette {
  background: string;
  text: string;
  keyword: string;
  builtin: string;
  type: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  attr: string;
  meta: string;
  literal: string;
}

/** Colours for data a chart or map draws (#1022), not status colours. */
export interface DataVizPalette {
  /** Eight category colours, in assignment order. Each is ≥3:1 against both
   *  theme surfaces and the theme's CARTO basemap. The JSONs are cast to
   *  `ThemeOptions`, so a tuple type couldn't hold the count:
   *  `theme-contrast.test.ts` holds it to eight. */
  categorical: string[];
  /** Categories past the eighth, and the legend's "+N more" swatch. */
  other: string;
  /** A gradient map's ramp, low to high: viridis stops each ≥3:1 against
   *  both theme surfaces and the theme's basemap (#1022). */
  sequential: string[];
}

declare module "@mui/material/styles" {
  interface Palette {
    /** #1072: the brand yellow of a favorited item's star (≥ 3:1 on both
     *  surfaces, `theme-contrast.test.ts`). */
    favorite: PaletteColor;
    sheet: SheetPalette;
    code: CodePalette;
    dataViz: DataVizPalette;
  }

  interface PaletteOptions {
    favorite?: PaletteColorOptions;
    sheet?: SheetPalette;
    code?: CodePalette;
    dataViz?: DataVizPalette;
  }

  interface TypographyVariants {
    monospace: CSSProperties;
  }

  // Allow configuration using `createTheme`
  interface TypographyVariantsOptions {
    monospace?: CSSProperties;
  }
}

// #1072: an IconButton can take the favorite colour (the star).
declare module "@mui/material/IconButton" {
  interface IconButtonPropsColorOverrides {
    favorite: true;
  }
}

// #1122: an icon can take it too (a favorite station's star in a menu).
declare module "@mui/material/SvgIcon" {
  interface SvgIconPropsColorOverrides {
    favorite: true;
  }
}

// Update the Typography's variant prop options
declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    monospace: true;
  }
}

export {};
