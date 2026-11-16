/**
 * #985: a mutation's cache refresh goes in the call's `invalidate` option,
 * never in its per-call `onSuccess` / `onError` / `onSettled`.
 *
 * React Query runs per-call callbacks only while the caller is mounted, so an
 * invalidation written there is lost when the user leaves the page while the
 * request is pending (browser Back during a rename): the write lands and
 * every other page keeps showing the old data. `useAuthMutation`'s
 * `invalidate` option runs from the request's promise, above the page (#970).
 *
 * The guard flags an `invalidateQueries(` / `refetchQueries(` /
 * `resetQueries(` call inside the options argument of `.mutate(…)`,
 * `.mutateAsync(…)`, or a call through a name destructured from either. It
 * also follows a name the options pass or call (`onSuccess: invalidateTags`,
 * `onSuccess: () => { refresh(); }`) to a function declared in the same file
 * that invalidates. An invalidation after `await mutateAsync(…)` is fine: the
 * promise settles whether or not the caller is mounted.
 *
 * What it can't see: a refresh reached through a prop or an imported
 * function (a dialog's `onSaved` that its parent wires), or a query's own
 * `.refetch()`. Those stay a review check: a dialog that saves refreshes
 * through its own call's `invalidate`, and its parent's callback only closes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import {
  localFunctionBodies,
  mutationCalls,
  sourceFiles,
} from "./guard-source.util";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Offending calls allowed, counted by file, each with its reason. The counts
 * only shrink: a per-file pass would hide every other call in the file.
 */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "views/EntityDetail.view.tsx": {
    count: 1,
    // Clear records: its onSuccess follows the clear *job* to completion over
    // the page's own SSE connection, and refreshes when the job ends. The
    // request's own refresh is on the `invalidate` option.
    reason: "job-completion refresh on page-scoped SSE",
  },
};

const INVALIDATE_CALL = /\b(?:invalidate|refetch|reset)Queries\(/;

/** Local functions that invalidate, directly or through another one. */
function invalidatingFunctions(source: string): string[] {
  const bodies = localFunctionBodies(source);
  const found = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of bodies) {
      if (found.has(name)) continue;
      if (
        INVALIDATE_CALL.test(body) ||
        [...found].some((f) => mentions(body, f))
      ) {
        found.add(name);
        grew = true;
      }
    }
  }
  return [...found];
}

/**
 * Whether `text` uses `name` as a value: not a member (`x.name`), not an
 * object key (`name:`), and not a shorthand property (`{ name }`), which in
 * a mutation's options is the option itself (`{ invalidate }`).
 */
function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/\$/g, "\\$");
  for (const m of text.matchAll(
    new RegExp(`(?<![\\w$.])${escaped}\\b(?!\\s*:)`, "g")
  )) {
    const before = text.slice(0, m.index);
    const after = text.slice(m.index! + name.length);
    const shorthand = /[{,]\s*$/.test(before) && /^\s*[,}]/.test(after);
    if (!shorthand) return true;
  }
  return false;
}

/** The mutation calls in `source` whose options argument invalidates. */
export function invalidatingMutationsIn(source: string): string[] {
  const helpers = invalidatingFunctions(source);
  return mutationCalls(source)
    .filter(
      ({ options }) =>
        options !== undefined &&
        (INVALIDATE_CALL.test(options) ||
          helpers.some((h) => mentions(options, h)))
    )
    .map(({ name, index, options }) => {
      const line = source.slice(0, index).split("\n").length;
      return `${name}(…) at line ${line}: ${options!.replace(/\s+/g, " ").trim().slice(0, 100)}`;
    });
}

describe("mutation cache refreshes go in the call's invalidate option (#985)", () => {
  const files = sourceFiles(webSrc).map((path) => ({
    path: relative(webSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the app's invalidate option uses (so the guard can't pass vacuously)", () => {
    const uses = files.filter((f) =>
      /\binvalidate:\s*[[\w(]/.test(f.source)
    ).length;
    expect(uses).toBeGreaterThanOrEqual(20);
  });

  it("no per-call mutation callback invalidates queries", () => {
    const offenders = files.flatMap((f) => {
      const calls = invalidatingMutationsIn(f.source);
      const allowed = ALLOWED[f.path]?.count ?? 0;
      return calls.length > allowed
        ? calls.map((call) => `${f.path}: ${call}`)
        : [];
    });
    expect(offenders).toEqual([]);
  });

  it("every allowlisted file still has exactly its counted calls (the list only shrinks)", () => {
    for (const [path, { count }] of Object.entries(ALLOWED)) {
      const file = files.find((f) => f.path === path);
      expect(file && invalidatingMutationsIn(file.source).length).toBe(count);
    }
  });

  describe("self-test", () => {
    const flags = (src: string) => invalidatingMutationsIn(src).length > 0;

    it("flags an invalidation in onSuccess, onError and onSettled", () => {
      expect(
        flags(
          `m.mutate(v, { onSuccess: () => { close(); qc.invalidateQueries({ queryKey: k }); } });`
        )
      ).toBe(true);
      expect(
        flags(`m.mutate(v, { onError: () => qc.invalidateQueries() });`)
      ).toBe(true);
      expect(
        flags(`m.mutateAsync(v, { onSettled: () => qc.invalidateQueries() });`)
      ).toBe(true);
    });

    it("flags a call through a destructured name", () => {
      expect(
        flags(
          `const { mutate: rename } = sdk.portals.rename(id);
           rename(v, { onSuccess: () => qc.invalidateQueries() });`
        )
      ).toBe(true);
    });

    it("flags a same-file function passed or called by name, also through another", () => {
      expect(
        flags(
          `const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: k }); }, [qc]);
           m.mutate(v, { onSuccess: refresh });`
        )
      ).toBe(true);
      expect(
        flags(
          `const refresh = () => qc.invalidateQueries({ queryKey: k });
           m.mutate(v, { onSuccess: () => { close(); refresh(); } });`
        )
      ).toBe(true);
      expect(
        flags(
          `function inner() { qc.invalidateQueries(); }
           const outer = useCallback(() => inner(), []);
           m.mutate(v, { onSuccess: outer });`
        )
      ).toBe(true);
    });

    it("follows React.useCallback, and flags refetchQueries and resetQueries", () => {
      expect(
        flags(
          `const refresh = React.useCallback(() => { qc.invalidateQueries(); }, [qc]);
           m.mutate(v, { onSuccess: refresh });`
        )
      ).toBe(true);
      expect(
        flags(`m.mutate(v, { onSuccess: () => qc.refetchQueries() });`)
      ).toBe(true);
      expect(
        flags(`m.mutate(v, { onSettled: () => qc.resetQueries() });`)
      ).toBe(true);
    });

    it("passes the invalidate option, an invalidation after the promise, and unrelated calls", () => {
      expect(
        flags(
          `const invalidate = () => qc.invalidateQueries();
           m.mutate(v, { invalidate: [k], onSuccess: () => close() });`
        )
      ).toBe(false);
      expect(
        flags(`await m.mutateAsync(v); qc.invalidateQueries({ queryKey: k });`)
      ).toBe(false);
      expect(
        flags(`save(v, { onSuccess: () => qc.invalidateQueries() });`)
      ).toBe(false);
      expect(
        flags(`m.mutate(v, { onSuccess: () => log("invalidateQueries(") });`)
      ).toBe(false);
      expect(
        flags(
          `const close = () => setOpen(false);
           m.mutate(v, { onSuccess: close });`
        )
      ).toBe(false);
      // Shorthand for the option itself, even beside a same-named helper.
      expect(
        flags(
          `function invalidate() { qc.invalidateQueries(); }
           m.mutate(v, { invalidate, onSuccess: () => close() });`
        )
      ).toBe(false);
    });
  });
});
