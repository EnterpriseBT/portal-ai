/**
 * Convention guard (#688): a permission-gated action renders through an
 * `ActionGate`, never a raw `disabled`.
 *
 * A `<Button disabled={!canX}>` is the pattern #684 found everywhere: the
 * button is dead, nothing says why, and the "can" is usually a class-level
 * guess that is wrong for the object in hand. The convention is to decide a
 * gate per object from its `capabilities` (`decideActionGate` /
 * `useActionGate`) and render it with `GatedButton`, `GatedIconButton` or a
 * gated menu/suite item, so a forbidden action is hidden and a blocked one
 * says why.
 *
 * This asserts over the source because the mistake is silent at runtime: the
 * button just doesn't work. It flags a `disabled={…}` on a `Button` or
 * `IconButton` whose expression reads a permission (`can(`, `canOnResource`,
 * `capabilities.`, a `can<Name>` flag or an `…Entitled` flag).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..");

/**
 * Known violations, owned by #691 (org & access), which empties this list.
 * Shrink-only: each file here must still violate, so a fixed file has to
 * leave the list.
 */
const KNOWN_VIOLATIONS: Record<string, string> = {
  "views/Settings.view.tsx": "#691",
  "components/TierCard.component.tsx": "#691",
  "components/SubscriptionBilling.component.tsx": "#691",
  "components/MembersTab.component.tsx": "#691",
};

/** `can*` names that aren't permissions (a form or wizard's readiness). */
const NON_PERMISSION_NAMES = [
  "canTest",
  "canAdvance",
  "canRemove",
  "canAddSegment",
];
/** Files whose `can*` names are all non-permission (filter-builder state). */
const NON_PERMISSION_FILES = new Set([
  "components/AdvancedFilterBuilder.component.tsx",
]);

const PERMISSION =
  /\bcan\(|\bcanOnResource\b|\bcapabilities\.|\bcan[A-Z]\w*|\w*Entitled\b/;
const NON_PERMISSION = new RegExp(
  `\\b(?:${NON_PERMISSION_NAMES.join("|")})\\b`,
  "g"
);
const GATED_TAGS = new Set(["Button", "IconButton"]);

/** The balanced `{…}` expression starting at `open` (the `{`). */
function braceExpression(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** The JSX tag a prop at `index` belongs to: the nearest `<Name` before it. */
function tagAt(source: string, index: number): string | null {
  const before = source.slice(0, index);
  const tags = [...before.matchAll(/<([A-Z][\w.]*)\b/g)];
  return tags.length ? tags[tags.length - 1][1] : null;
}

/** Every permission-reading `disabled={…}` on a Button/IconButton. */
export function violationsIn(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\bdisabled=\{/g)) {
    const open = m.index! + m[0].length - 1;
    const tag = tagAt(source, m.index!);
    if (!tag || !GATED_TAGS.has(tag)) continue;
    const expr = braceExpression(source, open);
    if (PERMISSION.test(expr.replace(NON_PERMISSION, ""))) {
      found.push(`<${tag} disabled={${expr.trim()}}>`);
    }
  }
  return found;
}

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

const violating = files
  .filter((f) => !NON_PERMISSION_FILES.has(f.path))
  .map((f) => ({ path: f.path, violations: violationsIn(f.source) }))
  .filter((f) => f.violations.length > 0);

describe("permission-gated actions render through an ActionGate (#688)", () => {
  it("scans the web source (so the guard can't pass vacuously)", () => {
    expect(files.length).toBeGreaterThanOrEqual(200);
  });

  it("no file outside the known list disables a button on a permission", () => {
    const unlisted = violating.filter((f) => !(f.path in KNOWN_VIOLATIONS));
    expect(unlisted).toEqual([]);
  });

  it.each(Object.keys(KNOWN_VIOLATIONS))(
    "%s still violates (the known list only shrinks)",
    (path) => {
      expect(violating.map((f) => f.path)).toContain(path);
    }
  );

  it("reports a probe that disables a button on a permission", () => {
    expect(
      violationsIn(
        `<Button onClick={() => go()} disabled={!canShare}>Share</Button>`
      )
    ).toHaveLength(1);
    expect(
      violationsIn(
        `<IconButton disabled={!row.capabilities.delete} aria-label="Delete" />`
      )
    ).toHaveLength(1);
    expect(
      violationsIn(`<Button disabled={!customToolpacksEntitled}>Add</Button>`)
    ).toHaveLength(1);
  });

  it("ignores non-permission state and non-button tags", () => {
    expect(
      violationsIn(`<Button disabled={!canAdvance}>Next</Button>`)
    ).toEqual([]);
    expect(violationsIn(`<Button disabled={isPending}>Save</Button>`)).toEqual(
      []
    );
    expect(violationsIn(`<TextField disabled={!canEdit} />`)).toEqual([]);
  });
});
