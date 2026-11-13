/**
 * Pairing and axe-detection rules shared by the component-axe guard and the
 * dialog-contract guard's R6 (#799), so the two can't drift. A plain module,
 * not a test file: importing a test file would register its tests twice.
 */

// A block comment only counts where it opens a line or a JSX expression, so
// a string like "image/*" can't swallow the code up to the next `*/`.
export const withoutComments = (source: string): string =>
  source
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, "$1")
    .replace(/^\s*\/\/.*$/gm, "");

/** Whether a test source runs the shared axe assertion. */
export function runsAxe(source: string): boolean {
  return /\bexpectNoAxeViolations\(/.test(withoutComments(source));
}

/** `modules/<X>/` or `workflows/<X>/`: the folder a path's module or
 *  workflow owns, or "" for anything else. */
const ownerOf = (path: string): string =>
  /^(modules|workflows)\/[^/]+\//.exec(path)?.[0] ?? "";

/**
 * The test files (paths relative to `src/`) named for a component file:
 * `<Name>.test.tsx`, or `<Name>.<kind>.test.tsx` where `<kind>` is the
 * component's own (`component`, `view` or `layout`). A test inside a module
 * or workflow pairs only with that module's or workflow's components, so
 * two components sharing a name (RegionEditor's and RestApi's `ReviewStep`)
 * can't pass on each other's test.
 */
export function pairedTests(componentPath: string, tests: string[]): string[] {
  const file = componentPath.split("/").pop()!;
  const kind = /\.(component|view|layout)\.tsx$/.exec(file)?.[1];
  const name = file
    .replace(/\.tsx$/, "")
    .replace(/\.(component|view|layout)$/, "");
  const names = [
    `${name}.test.tsx`,
    ...(kind ? [`${name}.${kind}.test.tsx`] : []),
  ];
  const owner = ownerOf(componentPath);
  return tests.filter((t) => {
    if (!names.includes(t.split("/").pop()!)) return false;
    const testOwner = ownerOf(t);
    return testOwner === "" || testOwner === owner;
  });
}
