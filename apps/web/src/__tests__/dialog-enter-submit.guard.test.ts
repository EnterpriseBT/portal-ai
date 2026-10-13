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
 *
 * #758: a submitting `Modal` with no form paper at all had nothing for Enter
 * to submit, and the checks above never looked at it because they start from
 * the form paper. A file that renders `<FormAlert>` beside a `<Modal>` is a
 * submitting dialog (the Form & Dialog Pattern requires the alert on every
 * mutating dialog), so each of its Modals must be a form.
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
// Comments are stripped first so a doc comment naming `<FormAlert>` doesn't
// make a wizard look like a submitting dialog. A block comment only counts
// where it opens a line or a JSX expression, so a string like "image/*"
// can't swallow the code up to the next `*/`.
const withoutComments = (source: string) =>
  source
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, "$1")
    .replace(/^\s*\/\/.*$/gm, "");

// A Modal that renders a FormAlert but submits nothing. Each entry says why;
// a new entry needs one as good.
const EXEMPT: Record<string, string> = {
  "components/EndpointTestDialog.component.tsx":
    "result viewer: the test request fires on open and Close is its only action",
};

const submittingDialogs = files.filter((f) => {
  const code = withoutComments(f.source);
  return /<Modal\b/.test(code) && /<FormAlert\b/.test(code);
});

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

  it("finds the submitting dialogs (so the guard can't pass vacuously)", () => {
    expect(submittingDialogs.length).toBeGreaterThanOrEqual(30);
  });

  it("ignores a /* inside a string", () => {
    const code = withoutComments(
      'accept="image/*"\n<Modal\n/** doc */\nslotProps={{ paper: { component: "form" } }}'
    );
    expect(code).toMatch(/<Modal\b/);
    expect(code).toMatch(/component:\s*"form"/);
    expect(code).not.toMatch(/doc/);
  });

  it("exempts only files that still exist and still match", () => {
    const matched = new Set(submittingDialogs.map((f) => f.path));
    for (const path of Object.keys(EXEMPT)) expect(matched).toContain(path);
  });

  it.each(
    submittingDialogs
      .filter((f) => !(f.path in EXEMPT))
      .map((f) => [f.path, withoutComments(f.source)])
  )("%s gives every Modal a form paper (#758)", (_path, code) => {
    const modals = code.match(/<Modal\b/g) ?? [];
    const forms = code.match(/component:\s*"form"/g) ?? [];
    expect(forms.length).toBeGreaterThanOrEqual(modals.length);
  });

  it.each(rawDefaultButtons.map((f) => [f.path, f.source]))(
    "%s passes disabled to FormDefaultButton",
    (_path, source) => {
      const buttons = source.match(/<FormDefaultButton\b[^>]*>/g) ?? [];
      for (const tag of buttons) expect(tag).toMatch(/\bdisabled=\{/);
    }
  );
});
