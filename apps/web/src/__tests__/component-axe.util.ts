/**
 * Pairing and axe-detection rules shared by the component-axe guard and the
 * dialog-contract guard's R6 (#799), so the two can't drift. A plain module,
 * not a test file: importing a test file would register its tests twice.
 */

/**
 * The source with every comment removed and every string, template and
 * regex literal emptied, so a search sees code only (#799): a call written
 * in a comment or inside quotes (`"expectNoAxeViolations(c)"`) isn't a call.
 * A single left-to-right scan, so `"image/*"`, `"https://x"` and `/a\/*\/`
 * can't open a comment. A `/` starts a regex where an operand is expected
 * (after punctuation, an operator or a keyword such as `return`), and is
 * division otherwise. `<` and `>` aren't such a token, so JSX's `</p>` stays
 * code. A template's `${…}` is emptied with it.
 */
export const codeOnly = (source: string): string => {
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

/** Whether a test source runs the shared axe assertion. */
export function runsAxe(source: string): boolean {
  return /\bexpectNoAxeViolations\(/.test(codeOnly(source));
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
