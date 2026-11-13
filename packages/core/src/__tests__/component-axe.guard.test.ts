/**
 * Component-axe guard (#799, epic #791). Every component under `src/ui/`
 * that has a test of its own (`src/__tests__/ui/<Name>.test.tsx`) must run
 * `expectNoAxeViolations` in it, so a component can't ship an axe
 * regression that jsdom could have caught. The story sweep
 * (`npm run a11y:stories`) covers the states stories render; this covers
 * the states tests drive.
 *
 * `AXE_EXEMPT` takes only a component jsdom can't render meaningfully,
 * with the reason. It starts empty and only shrinks. The floor stops the
 * guard passing vacuously if the scan ever finds nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "src");
const UI = path.join(SRC, "ui");
const UI_TESTS = path.join(SRC, "__tests__", "ui");

/** Components exempt from the rule, keyed by path under `src/`. */
const AXE_EXEMPT: Record<string, string> = {};

/** The fewest paired components the scan may find (39 when written). */
const PAIRED_FLOOR = 34;

/**
 * Comments, stripped where they open a line or follow whitespace or
 * punctuation: a trailing line or block comment after code goes, while a
 * string like "image/*" or "https://x" can't swallow the code after it.
 * The same rule as web's `component-axe.util.ts`.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/(^|[\s;,(){}[\]=])\/\*[\s\S]*?\*\//gm, "$1")
    .replace(/(^|[\s;,(){}[\]=])\/\/.*$/gm, "$1");

/** Whether a test source calls `expectNoAxeViolations(` outside a comment. */
function runsAxe(source: string): boolean {
  return /\bexpectNoAxeViolations\(/.test(withoutComments(source));
}

/** The tests among `tests` (file names in `src/__tests__/ui/`) that are the
 *  component's own: `<Name>.test.tsx`. */
function pairedTests(componentPath: string, tests: string[]): string[] {
  const name = path.basename(componentPath, ".tsx");
  return tests.filter((t) => t === `${name}.test.tsx`);
}

function components(): string[] {
  return (readdirSync(UI, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join("ui", f).split(path.sep).join("/"))
    .sort();
}

const tests = readdirSync(UI_TESTS);
const paired = components()
  .map((component) => ({ component, tests: pairedTests(component, tests) }))
  .filter((p) => p.tests.length > 0);

describe("runsAxe", () => {
  it("finds a call", () => {
    expect(runsAxe("await expectNoAxeViolations(container);")).toBe(true);
  });

  it("ignores an import with no call", () => {
    expect(
      runsAxe('import { expectNoAxeViolations } from "../axe.util";')
    ).toBe(false);
  });

  it("ignores a call inside a line or block comment", () => {
    expect(runsAxe("// await expectNoAxeViolations(container);")).toBe(false);
    expect(runsAxe("/* expectNoAxeViolations(container) */")).toBe(false);
  });

  it("ignores a call in a trailing comment after code", () => {
    expect(runsAxe("render(<X />); // expectNoAxeViolations(c)")).toBe(false);
    expect(runsAxe("doX(); /* expectNoAxeViolations(c) */")).toBe(false);
  });

  it("keeps a call after a string holding `/*`", () => {
    expect(
      runsAxe(
        'const accept = "image/*";\nawait expectNoAxeViolations(c);\n// */'
      )
    ).toBe(true);
  });

  it("keeps code after a URL's `//`", () => {
    expect(
      runsAxe('const u = "https://x"; await expectNoAxeViolations(c);')
    ).toBe(true);
  });
});

describe("pairedTests", () => {
  it("pairs a component with its own test only", () => {
    expect(
      pairedTests("ui/Modal.tsx", [
        "Modal.test.tsx",
        "Modal.types.test.tsx",
        "ModalFoo.test.tsx",
      ])
    ).toEqual(["Modal.test.tsx"]);
  });

  it("pairs a nested component by its base name", () => {
    expect(
      pairedTests("ui/searchable-select/SearchableSelect.tsx", [
        "SearchableSelect.test.tsx",
      ])
    ).toEqual(["SearchableSelect.test.tsx"]);
  });
});

describe("component tests run axe", () => {
  it(`scans at least ${PAIRED_FLOOR} paired components`, () => {
    expect(paired.length).toBeGreaterThanOrEqual(PAIRED_FLOOR);
  });

  it("lists no stale exemption", () => {
    const known = new Set(components());
    expect(Object.keys(AXE_EXEMPT).filter((k) => !known.has(k))).toEqual([]);
  });

  it.each(paired)("$component", ({ component, tests: own }) => {
    if (component in AXE_EXEMPT) return;
    const withAxe = own.filter((t) =>
      runsAxe(readFileSync(path.join(UI_TESTS, t), "utf8"))
    );
    expect({ component, runsAxe: withAxe.length > 0 }).toEqual({
      component,
      runsAxe: true,
    });
  });
});
