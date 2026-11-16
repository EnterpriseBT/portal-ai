/**
 * #984: a long unbroken token (a 120-character name, a URL, an id) ran past a
 * dialog's edge and was clipped (WCAG 1.4.10). The themes let it break:
 *
 * - Content: `break-word`. It's inherited by everything in the dialog, and
 *   `anywhere` would also shrink every word's min-content width, so tables and
 *   button rows would split ordinary words instead of scrolling.
 * - Title: `anywhere`. Modal's title is a flex container, whose text won't
 *   shrink below its longest word under `break-word`. It holds only its text.
 *
 * jsdom has no layout, so the smoke walk measures the overflow; these pin the
 * theme and that Modal's own styles don't override it.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";

import { Modal } from "../../ui/Modal";
import {
  THEME_MAP,
  ThemeProvider,
  type ThemeName,
} from "../../ui/ThemeProvider";

type RootOverride = { root?: Record<string, unknown> };

const EXPECTED = {
  MuiDialogContent: "break-word",
  MuiDialogTitle: "anywhere",
} as const;

const LONG_NAME = "Adv" + "L".repeat(117);

describe.each(Object.keys(THEME_MAP) as ThemeName[])(
  "%s dialog text wrapping (#984)",
  (name) => {
    it.each(Object.entries(EXPECTED))(
      "%s wraps with %s and keeps its padding",
      (component, wrap) => {
        const root = (
          THEME_MAP[name].components?.[component as keyof typeof EXPECTED]
            ?.styleOverrides as RootOverride
        )?.root;
        expect(root?.overflowWrap).toBe(wrap);
        expect(root?.padding).toBeDefined();
      }
    );

    it("applies both to the dialog Modal renders", () => {
      render(
        <ThemeProvider defaultTheme={name}>
          <Modal open onClose={jest.fn()} title={LONG_NAME}>
            <p>Delete {LONG_NAME}?</p>
          </Modal>
        </ThemeProvider>
      );
      const title = screen.getByRole("heading", { name: LONG_NAME });
      const content = screen.getByText(/^Delete /).parentElement!;
      expect(window.getComputedStyle(title).overflowWrap).toBe("anywhere");
      expect(window.getComputedStyle(content).overflowWrap).toBe("break-word");
    });
  }
);
