/**
 * Convention guard (#685) — Enter submits a dialog form only when its
 * visible submit could.
 *
 * Dialog actions are type="button", so `Modal` supplies a hidden default
 * button (`FormDefaultButton`) that makes Enter submit a form dialog with any
 * number of fields. That button must be disabled whenever the visible submit
 * is (a request in flight, an incomplete form), or Enter submits what the
 * button refuses: pressing Enter twice during a pending create made two.
 *
 * So every form dialog passes `submitDisabled` to `Modal`, and every raw
 * `<form>` that renders `FormDefaultButton` passes it `disabled`. This asserts
 * over the source because the omission is silent at runtime: a dialog without
 * the prop works on the happy path and duplicates on a double Enter.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories"
        ? []
        : sourceFiles(path);
    }
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const files = sourceFiles(webSrc).map((path) => ({
  path: relative(webSrc, path),
  source: readFileSync(path, "utf8"),
}));

// A Modal whose paper is a form. (Other form surfaces, like the region
// editor's binding popover, carry a real type="submit" button, and native
// implicit submission already follows its disabled state.)
const formDialogs = files.filter(
  (f) => /<Modal\b/.test(f.source) && /component:\s*"form"/.test(f.source)
);
const rawDefaultButtons = files.filter((f) =>
  /<FormDefaultButton\b/.test(f.source)
);

describe("dialog forms gate Enter like their submit button (#685)", () => {
  it("finds the form dialogs (so the guard can't pass vacuously)", () => {
    expect(formDialogs.length).toBeGreaterThanOrEqual(30);
  });

  it.each(formDialogs.map((f) => [f.path, f.source]))(
    "%s passes submitDisabled to every form Modal",
    (_path, source) => {
      const forms = source.match(/component:\s*"form"/g) ?? [];
      const gates = source.match(/\bsubmitDisabled=\{/g) ?? [];
      expect(gates.length).toBeGreaterThanOrEqual(forms.length);
    }
  );

  it.each(rawDefaultButtons.map((f) => [f.path, f.source]))(
    "%s passes disabled to FormDefaultButton",
    (_path, source) => {
      const buttons = source.match(/<FormDefaultButton\b[^>]*>/g) ?? [];
      for (const tag of buttons) expect(tag).toMatch(/\bdisabled=\{/);
    }
  );
});
