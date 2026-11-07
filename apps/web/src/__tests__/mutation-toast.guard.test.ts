/**
 * #970: a toast about a mutation's outcome goes in the call's `toast` option,
 * never in its per-call `onSuccess` / `onError` / `onSettled`.
 *
 * React Query runs per-call callbacks only while the caller is mounted, so a
 * toast raised there is lost when the user navigates away while the request
 * is pending (browser Back during an invite). `useAuthMutation`'s `toast` and
 * `invalidate` options run from the request's promise, above the page.
 *
 * The guard flags a `toast.<severity>(` call inside the options argument (the
 * second) of `.mutate(…)`, `.mutateAsync(…)`, or a call through a name
 * destructured from either. A toast after `await mutateAsync(…)` is fine: the
 * promise settles whether or not the caller is mounted.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import {
  argumentsAt,
  blankLiterals,
  sourceFiles,
  topLevelArgs,
} from "./guard-source.util";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Offending calls allowed, by file, each with its reason. Only shrinks. */
const ALLOWED: Record<string, string> = {
  // Its onSuccess toasts report the clear-records *job* finishing, tracked
  // over the page's own SSE connection, not the request's outcome. The
  // request's own toast is on the `toast` option.
  "views/EntityDetail.view.tsx": "job-completion toasts on page-scoped SSE",
};

/** Names bound from `mutate` / `mutateAsync` by object destructuring. */
function destructuredNames(blanked: string): string[] {
  const names = new Set<string>();
  for (const m of blanked.matchAll(
    /[{,]\s*(mutate|mutateAsync)\b(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*(?=[,}=])/g
  )) {
    names.add(m[2] ?? m[1]!);
  }
  return [...names];
}

const TOAST_CALL = /\btoast\.(?:success|error|info|warning|show)\(/;

/** The mutation calls in `source` whose options argument raises a toast. */
export function toastingMutationsIn(source: string): string[] {
  const blanked = blankLiterals(source);
  const names = destructuredNames(blanked);
  const found: string[] = [];
  for (const call of blanked.matchAll(
    /(?:\.(?:mutate|mutateAsync)|(?<![\w$.])[A-Za-z_$][\w$]*)\(/g
  )) {
    const name = call[0].replace(/^\./, "").slice(0, -1);
    const viaMember = call[0].startsWith(".");
    if (!viaMember && !names.includes(name)) continue;
    const args = topLevelArgs(
      argumentsAt(blanked, call.index! + call[0].length - 1)
    );
    const options = args[1];
    if (options && TOAST_CALL.test(options)) {
      found.push(
        `${name}(…): ${options.replace(/\s+/g, " ").trim().slice(0, 100)}`
      );
    }
  }
  return found;
}

describe("mutation toasts go in the call's toast option (#970)", () => {
  const files = sourceFiles(webSrc).map((path) => ({
    path: relative(webSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the app's toast option uses (so the guard can't pass vacuously)", () => {
    const uses = files.filter((f) => /\btoast:\s*\{/.test(f.source)).length;
    expect(uses).toBeGreaterThanOrEqual(5);
  });

  it("no per-call mutation callback raises a toast", () => {
    const offenders = files
      .filter((f) => !(f.path in ALLOWED))
      .flatMap((f) =>
        toastingMutationsIn(f.source).map((call) => `${f.path}: ${call}`)
      );
    expect(offenders).toEqual([]);
  });

  it("every allowlisted file still has an offending call (the list only shrinks)", () => {
    for (const path of Object.keys(ALLOWED)) {
      const file = files.find((f) => f.path === path);
      expect(file && toastingMutationsIn(file.source).length).toBeGreaterThan(
        0
      );
    }
  });

  describe("self-test", () => {
    const flags = (src: string) => toastingMutationsIn(src).length > 0;

    it("flags a toast in onSuccess, onError and onSettled", () => {
      expect(
        flags(`m.mutate(v, { onSuccess: () => toast.success("Saved") });`)
      ).toBe(true);
      expect(
        flags(`m.mutate(v, { onError: (e) => { toast.error(msg(e)); } });`)
      ).toBe(true);
      expect(
        flags(`m.mutateAsync(v, { onSettled: () => toast.info("x") });`)
      ).toBe(true);
    });

    it("flags a call through a destructured name", () => {
      expect(
        flags(
          `const { mutate: invite } = sdk.invitations.create();
           invite(v, { onSuccess: () => toast.success("Invited") });`
        )
      ).toBe(true);
    });

    it("passes the toast option, a toast after the promise, and unrelated calls", () => {
      expect(flags(`m.mutate(v, { toast: { success: "Saved" } });`)).toBe(
        false
      );
      expect(flags(`await m.mutateAsync(v); toast.success("Saved");`)).toBe(
        false
      );
      expect(flags(`save(v, { onSuccess: () => toast.success("x") });`)).toBe(
        false
      );
      expect(
        flags(`m.mutate(v, { onSuccess: () => log("toast.success(") });`)
      ).toBe(false);
    });
  });
});
