import { describe, it, expect } from "@jest/globals";
import { z } from "zod";

import * as contracts from "../../contracts/index.js";

/**
 * #801: a user-authored name, label, title, description or key in a request
 * body has a length limit. Before this guard a 10,000-character station name
 * was a 201: nothing between the field and a `text` column bounded it.
 *
 * The sweep covers every exported `*BodySchema` / `*RequestSchema` (the same
 * enumeration as `strict-request-bodies.test.ts`) and walks into nested
 * objects, arrays and wrappers. A guarded field whose string has no `max`
 * fails unless `EXEMPT` records why. Compose `nameField` / `descriptionField`
 * / `keyField` (`text-limits.contract.ts`) rather than an inline `.max()`.
 */
const GUARDED_FIELDS = new Set([
  "name",
  "label",
  "title",
  "description",
  "notes",
  "key",
  "normalizedKey",
  "axisName",
  "validationMessage",
  "proposedLabel",
  "displayName",
]);

/** `<Schema>` or `<Schema>.<path>` → why it has no limit. Only shrinks. */
const EXEMPT: Record<string, string> = {
  "LayoutPlanCommitDraftRequestBodySchema.plan":
    "LayoutPlanSchema also parses stored plans on replay, and its axis names and header locators are spreadsheet text; the user-authored parts are bounded by planTextLimitIssues",
  InterpretRequestBodySchema:
    "interpret hints (proposed labels, notes) are prompt input, never stored as an object's label",
  LayoutPlanInterpretDraftRequestBodySchema:
    "interpret hints are prompt input, and priorPlan is a stored plan (see the commit draft's plan); the commit bounds what becomes an object",
};

const isRequestBodyName = (name: string): boolean =>
  /(BodySchema|RequestSchema)$/.test(name) &&
  !/(Query|Response|Payload)/.test(name);

const isSchema = (v: unknown): v is z.ZodType =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { safeParse?: unknown }).safeParse === "function";

const REQUEST_BODIES: Array<[string, z.ZodType]> = Object.entries(contracts)
  .filter(([name, v]) => isRequestBodyName(name) && isSchema(v))
  .map(([name, v]) => [name, v as z.ZodType]);

interface Finding {
  path: string;
  bounded: boolean;
}

type Def = Record<string, unknown> & { type: string };
const defOf = (s: unknown): Def => (s as { _zod: { def: Def } })._zod.def;

/** Every guarded string field under `schema`, with whether it has a `max`.
 *  `path` is dot-joined; array elements and record values add no segment. */
function guardedStrings(
  schema: unknown,
  path: string,
  field: string | undefined,
  out: Finding[],
  seen = new Set<unknown>()
): Finding[] {
  if (seen.has(schema)) return out;
  seen.add(schema);
  const def = defOf(schema);
  const recur = (s: unknown, p = path, f = field) =>
    guardedStrings(s, p, f, out, seen);
  switch (def.type) {
    case "string":
      if (field !== undefined && GUARDED_FIELDS.has(field)) {
        out.push({
          path,
          bounded: (schema as z.ZodString).maxLength !== null,
        });
      }
      return out;
    case "object":
      for (const [key, value] of Object.entries(
        def.shape as Record<string, unknown>
      )) {
        recur(value, path ? `${path}.${key}` : key, key);
      }
      return out;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return recur(def.innerType);
    case "pipe":
      recur(def.in);
      return recur(def.out);
    case "array":
      return recur(def.element);
    case "record":
      return recur(def.valueType);
    case "union":
      for (const option of def.options as unknown[]) recur(option);
      return out;
    case "intersection":
      recur(def.left);
      return recur(def.right);
    case "tuple":
      for (const item of def.items as unknown[]) recur(item);
      return out;
    case "lazy":
      return recur((def.getter as () => unknown)());
    default:
      return out;
  }
}

const isExempt = (schemaName: string, path: string): boolean =>
  schemaName in EXEMPT ||
  Object.keys(EXEMPT).some(
    (k) =>
      k.startsWith(`${schemaName}.`) &&
      (`${schemaName}.${path}` === k ||
        `${schemaName}.${path}`.startsWith(`${k}.`))
  );

const FINDINGS = REQUEST_BODIES.flatMap(([name, schema]) =>
  guardedStrings(schema, "", undefined, []).map((f) => ({ ...f, name }))
);
const CHECKED = FINDINGS.filter((f) => !isExempt(f.name, f.path));

describe("user-authored text has a length limit (#801)", () => {
  it("finds the guarded fields to check", () => {
    // A rename or a walker regression would empty the sweep silently.
    expect(CHECKED.length).toBeGreaterThanOrEqual(30);
    expect(CHECKED.map((f) => `${f.name}.${f.path}`)).toEqual(
      expect.arrayContaining([
        "CreateStationBodySchema.name",
        "CreateStationBodySchema.description",
        "FieldMappingCreateRequestBodySchema.normalizedKey",
      ])
    );
  });

  it("every guarded field has a max", () => {
    const unbounded = CHECKED.filter((f) => !f.bounded).map(
      (f) => `${f.name}.${f.path}`
    );
    expect(unbounded).toEqual([]);
  });

  it("every EXEMPT entry still names a guarded field", () => {
    for (const key of Object.keys(EXEMPT)) {
      const [schemaName, ...rest] = key.split(".");
      const path = rest.join(".");
      const matches = FINDINGS.filter(
        (f) =>
          f.name === schemaName &&
          (path === "" || f.path === path || f.path.startsWith(`${path}.`))
      );
      expect({ key, matched: matches.length > 0 }).toEqual({
        key,
        matched: true,
      });
    }
  });

  it("the walker finds an unbounded name nested in an optional array", () => {
    const Fixture = z
      .object({
        items: z
          .array(z.object({ name: z.string(), id: z.string() }))
          .optional(),
        label: z.string().max(5).nullable(),
      })
      .strict();
    expect(guardedStrings(Fixture, "", undefined, [])).toEqual([
      { path: "items.name", bounded: false },
      { path: "label", bounded: true },
    ]);
  });
});
