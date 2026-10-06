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
 * Known violations. #691 (org & access) emptied it. Shrink-only: each file
 * here must still violate, so a fixed file has to leave the list, and a new
 * entry needs a ticket that removes it again.
 */
const KNOWN_VIOLATIONS: Record<string, string> = {};

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

/**
 * The JSX tag a prop at `index` belongs to. Walks back to the `<Name` that
 * opens the element, skipping anything inside `{…}`, so JSX in an earlier prop
 * (`startIcon={<DeleteIcon />}`) isn't mistaken for the owner.
 */
function tagAt(source: string, index: number): string | null {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return null; // the prop isn't on a JSX element
      depth--;
    } else if (ch === "<" && depth === 0) {
      const name = /^<([A-Z][\w.]*)\b/.exec(source.slice(i));
      if (name) return name[1];
    }
  }
  return null;
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

  it("every file on the known list still violates (the list only shrinks)", () => {
    // #691 emptied the list; a new entry needs a ticket that removes it.
    const violatingPaths = violating.map((f) => f.path);
    for (const path of Object.keys(KNOWN_VIOLATIONS)) {
      expect(violatingPaths).toContain(path);
    }
  });

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
    // JSX inside an earlier prop (startIcon) is not the tag that owns disabled.
    expect(
      violationsIn(
        `<Button startIcon={<DeleteIcon />} onClick={() => go(<X />)} disabled={!canDelete}>Delete</Button>`
      )
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

// ── #708: a create gate reads `create`, never `write`/`delete` ───────────

/**
 * `resourcePermissions[type].write`/`.delete` are any-grant signals
 * (`canPerformAny`): true for an owned-only, `created_by_system`-only or
 * instance-only grant, none of which a create route accepts. So a Create gated
 * on them is enabled for callers the route refuses, which is how every member
 * got an enabled-but-403 Create View. A create reads
 * `canOnResource(type, "create")` (the create route's own check); per-object
 * write/delete come from the row's `capabilities`.
 */
const ANY_GRANT_GATE =
  /\bcanOnResource\(\s*["'][a-z_]+["']\s*,\s*["'](write|delete)["']\s*\)/g;

/** Source with comments removed (a doc comment may cite the old form). A
 *  `//` right after `:` is a URL in a string, not a comment. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every `canOnResource(type, "write" | "delete")` in code. */
export function anyGrantGatesIn(source: string): string[] {
  return [...stripComments(source).matchAll(ANY_GRANT_GATE)].map((m) => m[0]);
}

function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories" ? [] : codeFiles(path);
    }
    return /\.tsx?$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
  });
}

describe("a create gate reads `create`, never `write`/`delete` (#708)", () => {
  const code = codeFiles(webSrc).map((path) => ({
    path: relative(webSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("scans .ts and .tsx (so the guard can't pass vacuously)", () => {
    expect(code.some((f) => f.path.endsWith(".util.ts"))).toBe(true);
    expect(code.length).toBeGreaterThan(files.length);
  });

  it("no web code gates on the any-grant write/delete", () => {
    const offenders = code
      .map((f) => ({ path: f.path, gates: anyGrantGatesIn(f.source) }))
      .filter((f) => f.gates.length > 0)
      .map(
        (f) =>
          `${f.path}: ${f.gates.join(", ")} — use canOnResource(type, "create") for a create; per-object write/delete come from the row's capabilities`
      );
    expect(offenders).toEqual([]);
  });

  it("flags the pattern in code, and ignores it in comments and URLs", () => {
    expect(
      anyGrantGatesIn(
        `const g = gate({ allowed: canOnResource("tag", "write") });`
      )
    ).toHaveLength(1);
    expect(
      anyGrantGatesIn(`if (canOnResource('pin','delete')) remove();`)
    ).toHaveLength(1);
    expect(
      anyGrantGatesIn(`/** was \`canOnResource("tag", "write")\` (#708) */`)
    ).toEqual([]);
    expect(
      anyGrantGatesIn(`// canOnResource("tag", "write") gated this once`)
    ).toEqual([]);
    expect(
      anyGrantGatesIn(
        `const u = "https://x.io"; const g = canOnResource("tag", "write");`
      )
    ).toHaveLength(1);
    expect(anyGrantGatesIn(`canOnResource("tag", "create")`)).toEqual([]);
    expect(anyGrantGatesIn(`canOnResource("tag", "read")`)).toEqual([]);
  });
});
