import { describe, it, expect } from "@jest/globals";

import {
  DARK_THEME_NAME,
  LIGHT_THEME_NAME,
  THEME_STORAGE_KEY,
} from "../../constants/theme.constants";
import { THEME_MAP } from "../../ui/ThemeProvider";

// #798: the app and the marketing site share one stored theme choice, so a
// visitor's choice travels between them. The key and names live here once.
describe("theme constants", () => {
  it("names the storage key both surfaces read", () => {
    expect(THEME_STORAGE_KEY).toBe("portalai-theme");
  });

  it("names themes the app's ThemeProvider actually has", () => {
    expect(Object.keys(THEME_MAP).sort()).toEqual(
      [LIGHT_THEME_NAME, DARK_THEME_NAME].sort()
    );
  });
});
