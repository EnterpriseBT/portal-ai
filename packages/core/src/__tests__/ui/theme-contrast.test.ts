/**
 * WCAG 2.2 AA contrast for the colour pairs the themes actually render
 * (#797). The thresholds are the contract; the hex values may move, as long
 * as these hold.
 *
 * - 1.4.3: text (status messages, links, button labels) ≥ 4.5:1.
 * - 1.4.11: the focus ring against the page ≥ 3:1.
 * - `text.disabled` is deliberately absent: WCAG exempts inactive controls.
 * - The sheet canvas (#996): its header text, every overlay chip, the
 *   decoration labels and the cell text under each overlay tint. Gridlines
 *   and the loading row's "…" are decorative and left out (headers and the
 *   keyboard grid locate a cell; "Loading…" is what's read).
 */
import { alpha, decomposeColor, getContrastRatio } from "@mui/material/styles";

import { THEME_MAP, type ThemeName } from "../../ui/ThemeProvider";

const TEXT = 4.5;
/** `fg` painted over an opaque `bg`, as the eye sees it (`getContrastRatio`
 *  ignores alpha). */
const composite = (fg: string, bg: string): string => {
  const f = decomposeColor(fg);
  const b = decomposeColor(bg);
  const a = f.values[3] ?? 1;
  const [r, g, bl] = [0, 1, 2].map((i) =>
    Math.round(f.values[i] * a + b.values[i] * (1 - a))
  );
  return `rgb(${r}, ${g}, ${bl})`;
};
const opaque = (color: string) => (decomposeColor(color).values[3] ?? 1) === 1;
/** The key paths of a nested token object, for the parity check. */
const keyPaths = (o: object, prefix = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? keyPaths(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );
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

  describe("the sheet canvas (#996)", () => {
    const sheet = palette.sheet;
    const surface = palette.background.paper;
    const chips = {
      "segment.field": sheet.segment.field.chip,
      "segment.pivot": sheet.segment.pivot.chip,
      "segment.skip": sheet.segment.skip.chip,
      "intersection.fieldField": sheet.intersection.fieldField.chip,
      "intersection.fieldPivot": sheet.intersection.fieldPivot.chip,
      "intersection.pivotPivot": sheet.intersection.pivotPivot.chip,
      "intersection.skipMixed": sheet.intersection.skipMixed.chip,
    };
    const { skippedStripe: _stripe, ...decorations } = sheet.decoration;
    const tints = {
      ...Object.fromEntries(
        Object.entries(decorations).map(([k, v]) => [`decoration.${k}`, v])
      ),
      "segment.field": sheet.segment.field.fill,
      "segment.pivot": sheet.segment.pivot.fill,
      "segment.skip": sheet.segment.skip.fill,
      "intersection.fieldField": sheet.intersection.fieldField.fill,
      "intersection.fieldPivot": sheet.intersection.fieldPivot.fill,
      "intersection.pivotPivot": sheet.intersection.pivotPivot.fill,
      "intersection.skipMixed": sheet.intersection.skipMixed.fill,
      "intersection.hover": sheet.intersection.hover,
      marquee: sheet.marquee,
    };

    it("header text is readable on the header", () => {
      expect(
        getContrastRatio(
          composite(sheet.headerText, sheet.headerBackground),
          sheet.headerBackground
        )
      ).toBeGreaterThanOrEqual(TEXT);
    });

    it.each(Object.entries(chips))(
      "the %s chip is opaque and its text readable",
      (_kind, chip) => {
        expect(opaque(chip)).toBe(true);
        expect(getContrastRatio(sheet.chipText, chip)).toBeGreaterThanOrEqual(
          TEXT
        );
      }
    );

    it("decoration labels sit on an opaque backdrop, readable", () => {
      expect(opaque(sheet.labelBackground)).toBe(true);
      expect(
        getContrastRatio(palette.text.primary, sheet.labelBackground)
      ).toBeGreaterThanOrEqual(TEXT);
    });

    const entities = [...sheet.entities, sheet.entityFallback];

    it.each(entities)(
      "the %s entity's tab text and badge are readable",
      (c) => {
        expect(getContrastRatio(sheet.entityText, c)).toBeGreaterThanOrEqual(
          TEXT
        );
        expect(
          getContrastRatio(c, sheet.badgeBackground)
        ).toBeGreaterThanOrEqual(TEXT);
      }
    );

    it.each(entities)(
      "the %s entity's outline stands out on the sheet and its headers",
      (c) => {
        expect(getContrastRatio(c, surface)).toBeGreaterThanOrEqual(NON_TEXT);
        expect(
          getContrastRatio(c, sheet.headerBackground)
        ).toBeGreaterThanOrEqual(NON_TEXT);
      }
    );

    it.each(Object.entries(sheet.confidence))(
      "the %s confidence colour stands out (dot, chip outline)",
      (_band, c) => {
        expect(getContrastRatio(c, surface)).toBeGreaterThanOrEqual(NON_TEXT);
      }
    );

    it.each(Object.entries(sheet.drift))(
      "text is readable on the %s drift banner",
      (_severity, bg) => {
        const banner = composite(bg, surface);
        expect(
          getContrastRatio(palette.text.primary, banner)
        ).toBeGreaterThanOrEqual(TEXT);
        expect(
          getContrastRatio(palette.text.secondary, banner)
        ).toBeGreaterThanOrEqual(TEXT);
      }
    );

    it("cell text stays readable under stacked tints", () => {
      // A cell can sit under its region's fill, a decoration, and a segment
      // or intersection tint (or the hover that replaces it), all at once.
      const overlays = [
        sheet.segment.field.fill,
        sheet.segment.pivot.fill,
        sheet.segment.skip.fill,
        sheet.intersection.fieldField.fill,
        sheet.intersection.fieldPivot.fill,
        sheet.intersection.pivotPivot.fill,
        sheet.intersection.skipMixed.fill,
        sheet.intersection.hover,
      ];
      let worst = { ratio: Infinity, stack: "" };
      for (const entity of entities) {
        const region = composite(alpha(entity, 0.1), surface);
        for (const [deco, decoFill] of Object.entries(decorations)) {
          const decorated = composite(decoFill, region);
          for (const overlay of overlays) {
            const ratio = getContrastRatio(
              palette.text.primary,
              composite(overlay, decorated)
            );
            if (ratio < worst.ratio) {
              worst = { ratio, stack: `${entity} + ${deco} + ${overlay}` };
            }
          }
        }
      }
      expect(worst).toMatchObject({ ratio: expect.any(Number) });
      expect(worst.ratio).toBeGreaterThanOrEqual(TEXT);
    });

    it("secondary text stays readable on an intersection note", () => {
      expect(
        getContrastRatio(
          palette.text.secondary,
          composite(sheet.intersection.pivotPivot.fill, surface)
        )
      ).toBeGreaterThanOrEqual(TEXT);
    });

    it("the axis-name anchor icon stands out on its label", () => {
      expect(
        getContrastRatio(sheet.anchorIcon, sheet.labelBackground)
      ).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it.each(Object.entries(tints))(
      "cell text stays readable under the %s tint",
      (_kind, tint) => {
        expect(
          getContrastRatio(palette.text.primary, composite(tint, surface))
        ).toBeGreaterThanOrEqual(TEXT);
      }
    );
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

it("both themes define the same sheet tokens (#996)", () => {
  // The JSONs are cast to ThemeOptions, so tsc can't catch a missing one.
  const [first, ...rest] = Object.values(THEME_MAP).map((t) =>
    keyPaths(t.palette.sheet).sort()
  );
  expect(first.length).toBeGreaterThan(0);
  for (const paths of rest) expect(paths).toEqual(first);
});
