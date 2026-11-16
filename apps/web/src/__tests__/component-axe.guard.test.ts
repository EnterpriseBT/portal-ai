/**
 * Component-axe guard (#799, epic #791). Every `*.component.tsx` and
 * `*.layout.tsx` under `src/` that has a test of its own must run
 * `expectNoAxeViolations` in it, so a component can't ship an axe
 * regression that jsdom could have caught. The dialog guard's R6 applies the same rule to
 * every component rendering a `Modal`, with or without a test.
 *
 * Pairing and detection live in `component-axe.util.ts`, shared with R6.
 * `AXE_EXEMPT` takes only a component jsdom can't render meaningfully,
 * with the reason. It starts empty and only shrinks. The floor stops the
 * guard passing vacuously if the scan ever finds nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pairedTests, runsAxe } from "./component-axe.util";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Components exempt from the rule, keyed by path under `src/`. */
const AXE_EXEMPT: Record<string, string> = {};

/** The fewest paired components the scan may find (183 when written). */
const PAIRED_FLOOR = 170;

const files = (readdirSync(webSrc, { recursive: true }) as string[])
  .map((f) => f.split("\\").join("/"))
  .sort();
const components = files.filter(
  (f) =>
    /\.(component|layout)\.tsx$/.test(f) &&
    !/(^|\/)(__tests__|stories)\//.test(f)
);
const tests = files.filter((f) => /\.test\.tsx$/.test(f));
const paired = components
  .map((component) => ({ component, own: pairedTests(component, tests) }))
  .filter((p) => p.own.length > 0);

describe("the guard's own rules (fixtures)", () => {
  it("sees an axe call, and not one in a comment or an import", () => {
    expect(runsAxe("await expectNoAxeViolations(container);")).toBe(true);
    expect(runsAxe("// expectNoAxeViolations(container);")).toBe(false);
    expect(runsAxe("/* expectNoAxeViolations(container) */")).toBe(false);
    expect(runsAxe("import { expectNoAxeViolations } from './x';")).toBe(false);
  });

  it("ignores a call in a trailing comment after code", () => {
    expect(runsAxe("render(<X />); // expectNoAxeViolations(c)")).toBe(false);
    expect(runsAxe("doX(); /* expectNoAxeViolations(c) */")).toBe(false);
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

  it("keeps a call after JSX closing tags on the same line", () => {
    expect(runsAxe("render(<p>Hi</p>); await expectNoAxeViolations(c);")).toBe(
      true
    );
  });

  it("keeps a call after a regex literal holding `/*`, or after division", () => {
    expect(
      runsAxe("const re = /a\\/*/;\nawait expectNoAxeViolations(c);\n// */")
    ).toBe(true);
    expect(runsAxe("const h = a / 2; await expectNoAxeViolations(c);")).toBe(
      true
    );
  });

  it("keeps a call after a string holding `/*`", () => {
    expect(
      runsAxe(
        'const accept = "image/*";\nawait expectNoAxeViolations(c);\n// */'
      )
    ).toBe(true);
  });

  it("pairs a component with its own test, by name and kind", () => {
    const tests = [
      "__tests__/Foo.test.tsx",
      "__tests__/Bar.component.test.tsx",
      "__tests__/Shell.layout.test.tsx",
      "__tests__/FooBar.test.tsx",
    ];
    expect(pairedTests("components/Foo.component.tsx", tests)).toEqual([
      "__tests__/Foo.test.tsx",
    ]);
    expect(pairedTests("components/Bar.component.tsx", tests)).toEqual([
      "__tests__/Bar.component.test.tsx",
    ]);
    expect(pairedTests("layouts/Shell.layout.tsx", tests)).toEqual([
      "__tests__/Shell.layout.test.tsx",
    ]);
  });

  it("doesn't pair across kinds", () => {
    expect(
      pairedTests("components/Shell.component.tsx", [
        "__tests__/Shell.layout.test.tsx",
      ])
    ).toEqual([]);
  });

  it("pairs a module's or workflow's test only within it", () => {
    const tests = ["modules/RegionEditor/__tests__/ReviewStep.test.tsx"];
    expect(
      pairedTests("modules/RegionEditor/ReviewStep.component.tsx", tests)
    ).toEqual(tests);
    expect(
      pairedTests("workflows/RestApiConnector/ReviewStep.component.tsx", tests)
    ).toEqual([]);
  });

  it("pairs nothing for a component with no test", () => {
    expect(
      pairedTests("components/None.component.tsx", ["__tests__/Foo.test.tsx"])
    ).toEqual([]);
  });
});

describe("component tests run axe", () => {
  it(`scans at least ${PAIRED_FLOOR} paired components`, () => {
    expect(paired.length).toBeGreaterThanOrEqual(PAIRED_FLOOR);
  });

  it("lists no stale exemption", () => {
    const known = new Set(components);
    expect(Object.keys(AXE_EXEMPT).filter((k) => !known.has(k))).toEqual([]);
  });

  it.each(paired)("$component", ({ component, own }) => {
    if (component in AXE_EXEMPT) return;
    const withAxe = own.filter((t) =>
      runsAxe(readFileSync(join(webSrc, t), "utf8"))
    );
    expect({ component, tests: own, runsAxe: withAxe.length > 0 }).toEqual({
      component,
      tests: own,
      runsAxe: true,
    });
  });
});
