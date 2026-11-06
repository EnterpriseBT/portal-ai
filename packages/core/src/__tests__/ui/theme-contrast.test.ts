/**
 * WCAG 2.2 AA contrast for the colour pairs the themes actually render
 * (#797). The thresholds are the contract; the hex values may move, as long
 * as these hold.
 *
 * - 1.4.3: text (status messages, links, button labels) ≥ 4.5:1.
 * - 1.4.11: the focus ring against the page ≥ 3:1.
 * - `text.disabled` is deliberately absent: WCAG exempts inactive controls.
 */
import { getContrastRatio } from "@mui/material/styles";

import { THEME_MAP, type ThemeName } from "../../ui/ThemeProvider";

const TEXT = 4.5;
const NON_TEXT = 3;

const STATUS = [
  "primary",
  "secondary",
  "error",
  "warning",
  "info",
  "success",
] as const;

describe.each(Object.keys(THEME_MAP) as ThemeName[])("%s contrast", (name) => {
  const { palette } = THEME_MAP[name];
  const backgrounds = {
    default: palette.background.default,
    paper: palette.background.paper,
  };

  describe.each(Object.entries(backgrounds))("on background.%s", (_bg, bg) => {
    it.each(["primary", "secondary"] as const)("text.%s is readable", (key) => {
      expect(getContrastRatio(palette.text[key], bg)).toBeGreaterThanOrEqual(
        TEXT
      );
    });

    it.each(STATUS)("%s.main is readable as text", (key) => {
      expect(getContrastRatio(palette[key].main, bg)).toBeGreaterThanOrEqual(
        TEXT
      );
    });

    it("the focus ring (primary.main) stands out", () => {
      expect(getContrastRatio(palette.primary.main, bg)).toBeGreaterThanOrEqual(
        NON_TEXT
      );
    });
  });

  it.each(STATUS)(
    "%s.contrastText is readable on its main (filled buttons, chips, alerts)",
    (key) => {
      expect(
        getContrastRatio(palette[key].contrastText, palette[key].main)
      ).toBeGreaterThanOrEqual(TEXT);
    }
  );
});
