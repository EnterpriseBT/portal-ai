import type { Theme } from "@mui/material/styles";

/**
 * The serializable theme tokens handed to a sandboxed D3 program as
 * `api.theme` (#268). The iframe cannot inherit MUI context — these
 * cross the postMessage bridge, so the shape must stay plain JSON.
 */
export interface D3SandboxTheme {
  mode: "light" | "dark";
  background: string;
  text: string;
  fontFamily: string;
  monospaceFontFamily: string;
  /** [primary, secondary, success, warning, error, info] mains, in order. */
  categorical: string[];
}

/** The brand themes register a custom `typography.monospace` variant. */
interface MonospaceTypography {
  monospace?: { fontFamily?: string };
}

export function buildSandboxTheme(theme: Theme): D3SandboxTheme {
  const { palette, typography } = theme;
  return {
    mode: palette.mode,
    background: palette.background.default,
    text: palette.text.primary,
    fontFamily: typography.fontFamily ?? "sans-serif",
    monospaceFontFamily:
      (typography as unknown as MonospaceTypography).monospace?.fontFamily ??
      "monospace",
    categorical: [
      palette.primary.main,
      palette.secondary.main,
      palette.success.main,
      palette.warning.main,
      palette.error.main,
      palette.info.main,
    ],
  };
}
