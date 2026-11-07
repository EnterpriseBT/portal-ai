/**
 * #711 (spec case 17): a toast shows a server error through
 * `serverErrorMessage`, never its raw `.message`. That keeps every refusal
 * reading the same in a toast as in a dialog (`FormAlert`), and keeps the
 * fallback when a message is empty.
 *
 * Asserted over the source because the drift is silent: a raw
 * `toast.error(err.message)` works, it just reads differently.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Toasts of a local, non-server `Error`, by file and an exact snippet. */
const LOCAL_ERROR_TOASTS: Array<{ file: string; snippet: string }> = [
  // Converting the editor's drafts failed client-side, before any request.
  {
    file: "views/EditLayoutPlan.view.tsx",
    snippet: "Couldn't save plan before commit: ${err.message}",
  },
];

/** The balanced `(…)` argument list starting at `open`. */
function argumentsAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** The balanced `{…}` body starting at `open`. */
function bracesAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/**
 * Every error toast's message expression: each `toast.error(…)` argument,
 * and (#970) each `error:` entry of a mutation's `toast: { … }` option, which
 * `useAuthMutation` raises itself.
 */
export function errorToastsIn(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\btoast\.error\(/g)) {
    found.push(argumentsAt(source, m.index! + m[0].length - 1));
  }
  for (const m of source.matchAll(/\btoast:\s*\{/g)) {
    const body = bracesAt(source, m.index! + m[0].length - 1);
    const entry = /\berror:/.exec(body);
    if (entry) found.push(body.slice(entry.index + entry[0].length));
  }
  return found;
}

/** Every error toast whose message reads a raw `.message`. */
export function rawMessageToastsIn(source: string): string[] {
  return errorToastsIn(source)
    .filter(
      (args) => /\.message\b/.test(args) && !/\bserverErrorMessage\(/.test(args)
    )
    .map((args) => args.replace(/\s+/g, " ").trim());
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories"
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("toasts show server errors through serverErrorMessage (#711)", () => {
  const files = sourceFiles(webSrc).map((path) => ({
    path: relative(webSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the app's toasts (so the guard can't pass vacuously)", () => {
    const toasts = files.reduce(
      (n, f) => n + errorToastsIn(f.source).length,
      0
    );
    expect(toasts).toBeGreaterThanOrEqual(15);
  });

  it("no toast shows a raw .message, except allowlisted local errors", () => {
    const offenders = files.flatMap((f) =>
      rawMessageToastsIn(f.source)
        .filter(
          (args) =>
            !LOCAL_ERROR_TOASTS.some(
              (a) => a.file === f.path && args.includes(a.snippet)
            )
        )
        .map((args) => `${f.path}: toast.error(${args})`)
    );
    expect(offenders).toEqual([]);
  });

  it("every allowlisted local-error toast still exists (the list only shrinks)", () => {
    for (const a of LOCAL_ERROR_TOASTS) {
      const file = files.find((f) => f.path === a.file);
      expect(file?.source.includes(a.snippet)).toBe(true);
    }
  });

  it("flags a raw message, and passes one through the helper", () => {
    expect(rawMessageToastsIn(`toast.error(error.message)`)).toHaveLength(1);
    expect(
      rawMessageToastsIn(`toast.error(toServerError(e)?.message ?? "x")`)
    ).toHaveLength(1);
    expect(
      rawMessageToastsIn(`toast.error(serverErrorMessage(e, "x"))`)
    ).toEqual([]);
    expect(
      rawMessageToastsIn("toast.error(`Failed: ${serverErrorMessage(err)}`)")
    ).toEqual([]);
  });

  it("checks a mutation's toast option too (#970)", () => {
    expect(
      rawMessageToastsIn(`m.mutate(v, { toast: { error: (e) => e.message } })`)
    ).toHaveLength(1);
    expect(
      rawMessageToastsIn(
        `m.mutate(v, { toast: { success: "Saved", error: "Failed to save" } })`
      )
    ).toEqual([]);
    expect(
      rawMessageToastsIn(
        "m.mutate(v, { toast: { error: (e) => `x: ${serverErrorMessage(e)}` } })"
      )
    ).toEqual([]);
  });
});
