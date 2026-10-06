/**
 * #688/#711: every mutation on an existing per-object resource declares
 * `onPermissionDenied: { invalidate }` on its `useAuthMutation`. A 403 there
 * means the caller's access changed under an open page (a share downgraded,
 * a grant removed), so the objects re-fetch and their affordances re-render.
 * Without it the page keeps offering the refused action: the #711 smoke walk
 * found Edit still showing on a station after its refusal, and the #688 sweep
 * had missed every station, pin and toolpack mutation the same way.
 *
 * Scope: the SDK files of the per-object types (CLAUDE.md, "Action
 * Affordances & Permissions"). A mutation targets an existing object when its
 * URL interpolates a value; a create posts to a fixed collection URL and has
 * no object to refresh, so it's exempt. RBAC administration, members,
 * invitations, billing and connector-specific workflows aren't per-object
 * types and are out of scope.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "api");

/** The SDK files whose mutations act on per-object types. */
const PER_OBJECT_API_FILES = [
  "api-connector.api.ts",
  "column-definitions.api.ts",
  "connector-entities.api.ts",
  "connector-instance-layout-plans.api.ts",
  "connector-instances.api.ts",
  "curated-views.api.ts",
  "entity-groups.api.ts",
  "entity-records.api.ts",
  "entity-tag-assignments.api.ts",
  "entity-tags.api.ts",
  "field-mappings.api.ts",
  "portal-results.api.ts",
  "portals.api.ts",
  "stations.api.ts",
  "toolpacks.api.ts",
];

/** `file:name` of a justified exception, with its reason. Shrink-only. */
const EXEMPT: Record<string, string> = {};

/** Source with comments blanked (string contents kept). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p: string) => p);
}

/** The balanced `{…}` starting at `open`. */
function objectAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/**
 * The whole value of `key` in an object literal: up to the next comma at the
 * value's own nesting depth, so a URL Prettier wraps onto the next line
 * (`url: ({ id }) =>` then the template) is read in full.
 */
function propertyValue(objectSource: string, key: string): string {
  const m = new RegExp(`\\b${key}\\s*:`).exec(objectSource);
  if (!m) return "";
  const start = m.index + m[0].length;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < objectSource.length; i++) {
    const c = objectSource[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      // A `${…}` inside a template opens a nested expression; the braces
      // balance, and the closing backtick ends the string.
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) {
      if (depth === 0) return objectSource.slice(start, i);
      depth--;
    } else if (c === "," && depth === 0) return objectSource.slice(start, i);
  }
  return objectSource.slice(start);
}

export interface MutationSite {
  name: string;
  targetsObject: boolean;
  declaresDenied: boolean;
}

/** Every `useAuthMutation` call in `source`, with its SDK property name. */
export function mutationsIn(source: string): MutationSite[] {
  const code = stripComments(source);
  const sites: MutationSite[] = [];
  // A call, not an import: the name is followed by its type arguments or `(`.
  for (const m of code.matchAll(/\buseAuthMutation\s*[<(]/g)) {
    const at = m.index!;
    // The config is the first object literal passed to the call.
    const callOpen = code.indexOf("(", at);
    const configOpen = code.indexOf("{", callOpen);
    if (callOpen < 0 || configOpen < 0) continue;
    const config = objectAt(code, configOpen);
    const names = [
      ...code.slice(0, at).matchAll(/(\w+)\s*:\s*(?:<[^>]*>)?\s*\(/g),
    ];
    const url = propertyValue(config, "url");
    sites.push({
      name: names.length ? names[names.length - 1][1] : "?",
      targetsObject: url.includes("${"),
      declaresDenied: /\bonPermissionDenied\s*:/.test(config),
    });
  }
  return sites;
}

describe("per-object mutations refresh on a permission denial (#688/#711)", () => {
  const files = PER_OBJECT_API_FILES.map((file) => ({
    file,
    sites: mutationsIn(readFileSync(join(apiDir, file), "utf8")),
  }));

  it("finds the mutations (so the guard can't pass vacuously)", () => {
    const all = files.flatMap((f) => f.sites);
    expect(all.length).toBeGreaterThanOrEqual(60);
    expect(all.filter((s) => s.targetsObject).length).toBeGreaterThanOrEqual(
      40
    );
    expect(all.some((s) => s.name === "?")).toBe(false);
  });

  it("every object-targeted mutation declares onPermissionDenied", () => {
    const offenders = files.flatMap(({ file, sites }) =>
      sites
        .filter((s) => s.targetsObject && !s.declaresDenied)
        .map((s) => `${file}:${s.name}`)
        .filter((key) => !(key in EXEMPT))
    );
    expect(offenders).toEqual([]);
  });

  it("every exemption still names a real, unhooked mutation", () => {
    for (const key of Object.keys(EXEMPT)) {
      const [file, name] = key.split(":");
      const site = files
        .find((f) => f.file === file)
        ?.sites.find((s) => s.name === name);
      expect([key, site?.targetsObject && !site.declaresDenied]).toEqual([
        key,
        true,
      ]);
    }
  });

  it("reads names, URLs and the hook across the shapes the SDK uses", () => {
    const sites = mutationsIn(`
      import {
        useAuthQuery,
        useAuthMutation,
      } from "../utils/api.util";
      export const x = {
        create: () =>
          useAuthMutation<A, B>({ url: "/api/things" }),
        update: (id: string) =>
          useAuthMutation<
            A,
            B
          >({
            url: \`/api/things/\${encodeURIComponent(id)}\`,
            method: "PATCH",
            onPermissionDenied: { invalidate: () => [k.root] },
          }),
        refresh: () =>
          useAuthMutation<A, { id: string }>({
            url: ({ id }) =>
              \`/api/things/\${encodeURIComponent(id)}/a-long-refresh-path\`,
            body: () => undefined,
          }),
        // remove: () => useAuthMutation({ url: \`/x/\${id}\` }),
        remove: () =>
          useAuthMutation<A, { id: string }>({
            url: ({ id }) => \`/api/things/\${encodeURIComponent(id)}\`,
            method: "DELETE",
          }),
      };
    `);
    expect(sites).toEqual([
      { name: "create", targetsObject: false, declaresDenied: false },
      { name: "update", targetsObject: true, declaresDenied: true },
      { name: "refresh", targetsObject: true, declaresDenied: false },
      { name: "remove", targetsObject: true, declaresDenied: false },
    ]);
  });
});
