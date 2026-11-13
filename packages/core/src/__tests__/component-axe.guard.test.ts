/**
 * Component-axe guard (#799, epic #791). Every component under `src/ui/`
 * that has a test of its own (`src/__tests__/ui/<Name>.test.tsx`) must run
 * `expectNoAxeViolations` in it, so a component can't ship an axe
 * regression that jsdom could have caught.
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
 * The source with every comment removed and every string, template and
 * regex literal emptied, so a search sees code only (#799): a call written
 * in a comment or inside quotes (`"expectNoAxeViolations(c)"`) isn't a call.
 * A single left-to-right scan, so `"image/*"`, `"https://x"` and `/a\/*\/`
 * can't open a comment. A `/` starts a regex where an operand is expected
 * (after punctuation, an operator or a keyword such as `return`), and is
 * division otherwise. `<` and `>` aren't such a token, so JSX's `</p>` stays
 * code. A template's `${…}` is emptied with it.
 * The same scanner as web's `component-axe.util.ts`.
 */
const codeOnly = (source: string): string => {
  let out = "";
  let i = 0;
  // The last significant code token, to tell a regex `/` from division.
  let prev = "";
  const n = source.length;
  const skipQuoted = (quote: string) => {
    i++;
    while (i < n && source[i] !== quote) {
      if (source[i] === "\\") i++;
      else if (quote !== "`" && source[i] === "\n") break;
      i++;
    }
    i++;
  };
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      out += " ";
    } else if (c === '"' || c === "'" || c === "`") {
      skipQuoted(c);
      out += c + c;
      prev = c;
    } else if (
      c === "/" &&
      (prev === "" ||
        /[(,=:[!&|?{};+\-*%~^]$/.test(prev) ||
        /\b(return|typeof|case|do|else|in|of|void|yield|await)$/.test(prev))
    ) {
      i++;
      let inClass = false;
      while (i < n && source[i] !== "\n") {
        if (source[i] === "\\") i++;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "/" && !inClass) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(source[i])) i++;
      out += "/ /";
      prev = "/";
    } else {
      out += c;
      if (!/\s/.test(c))
        prev = /[\w$]/.test(c) ? (/[\w$]$/.test(prev) ? prev + c : c) : c;
      i++;
    }
  }
  return out;
};

/** Whether a test source calls `expectNoAxeViolations(` in code. */
function runsAxe(source: string): boolean {
  return /\bexpectNoAxeViolations\(/.test(codeOnly(source));
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

  it("ignores a call written inside a string or template literal", () => {
    expect(runsAxe('const note = "expectNoAxeViolations(container)";')).toBe(
      false
    );
    expect(runsAxe("const n = 'expectNoAxeViolations(c)';")).toBe(false);
    expect(runsAxe("const n = `expectNoAxeViolations(${c})`;")).toBe(false);
  });

  it("keeps a call after a regex literal holding `/*`", () => {
    expect(
      runsAxe("const re = /a\\/*/;\nawait expectNoAxeViolations(c);\n// */")
    ).toBe(true);
  });

  it("keeps a call after JSX closing tags on the same line", () => {
    expect(runsAxe("render(<p>Hi</p>); await expectNoAxeViolations(c);")).toBe(
      true
    );
  });

  it("keeps a call after division", () => {
    expect(runsAxe("const h = a / 2; await expectNoAxeViolations(c);")).toBe(
      true
    );
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
