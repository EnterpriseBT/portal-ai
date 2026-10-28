/**
 * Built-in toolpack mirror ⇔ the tools' real input schemas (#615).
 *
 * `BUILTIN_TOOLPACKS` (`@portalai/core/registries`) hand-authors a
 * `parameterSchema` for every pack tool, because core can't import the API's
 * tool classes. The toolpack modal and `GET /api/toolpacks` show that mirror;
 * the agent gets the tool's own Zod schema. Nothing compared the two, so the
 * mirror drifted silently: #615 found eight entity/mapping/record tools whose
 * mirror named fields the tool doesn't take (`ids`, `id`, `refKey`) or left
 * out ones it requires (`normalizedKey`), and a `sql_query` mirror describing
 * a parameter that doesn't exist.
 *
 * The comparison is structural and by name only: the same property keys and
 * the same `required` keys, recursing into nested objects and array items.
 * Descriptions, types and bounds are deliberately not compared, so a mirror
 * may still summarise. Two more allowances keep it about drift, not style:
 * - a mirror field declared as an opaque object (`type: "object"` with no
 *   `properties`, its shape given in prose) summarises the tool's nested
 *   schema rather than contradicting it;
 * - a union of object shapes (a discriminated union such as a grantee) reads
 *   as its merged properties, required only where every branch requires it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, it, expect } from "@jest/globals";
import { z, type ZodType } from "zod";

import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";

import { Tool } from "../../types/tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(here, "../../tools");

/** Tools whose mirror may legitimately differ, each with its reason.
 *  Empty, and it only shrinks. */
const SCHEMA_PARITY_EXEMPT: Record<string, string> = {};

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
};

/** Follows a local `#/$defs/…` (or `#`) reference against the root schema. */
function deref(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let current = schema;
  for (let hops = 0; current.$ref && hops < 10; hops++) {
    const ref = current.$ref;
    if (ref === "#") current = root;
    else if (ref.startsWith("#/$defs/")) {
      current = root.$defs?.[ref.slice("#/$defs/".length)] ?? {};
    } else break;
  }
  return current;
}

/** The object schema a field resolves to, through refs, arrays and unions;
 *  null when the field isn't an object with declared properties. */
function objectShape(
  schema: JsonSchema | undefined,
  root: JsonSchema
): JsonSchema | null {
  if (!schema) return null;
  const s = deref(schema, root);
  if (s.properties) return s;
  if (s.items) return objectShape(s.items, root);
  const branches = [...(s.anyOf ?? []), ...(s.oneOf ?? []), ...(s.allOf ?? [])]
    .map((b) => objectShape(b, root))
    .filter((b): b is JsonSchema => b !== null);
  if (branches.length === 0) return null;
  if (branches.length === 1) return branches[0];
  const properties: Record<string, JsonSchema> = {};
  for (const b of branches) Object.assign(properties, b.properties);
  const required = (branches[0].required ?? []).filter((k) =>
    branches.every((b) => (b.required ?? []).includes(k))
  );
  return { type: "object", properties, required };
}

/** An object field (or array of objects) whose shape the mirror gives in
 *  prose, not properties. */
function isOpaqueObject(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  if (schema.type === "array") return isOpaqueObject(schema.items);
  return (
    schema.type === "object" &&
    !schema.properties &&
    !schema.items &&
    !schema.anyOf &&
    !schema.oneOf
  );
}

/** Every structural mismatch between two schemas, as readable paths. */
function diffShapes(
  actual: JsonSchema,
  mirror: JsonSchema,
  at: string,
  actualRoot: JsonSchema,
  mirrorRoot: JsonSchema
): string[] {
  const problems: string[] = [];
  const actualKeys = Object.keys(actual.properties ?? {}).sort();
  const mirrorKeys = Object.keys(mirror.properties ?? {}).sort();
  for (const k of actualKeys) {
    if (!mirrorKeys.includes(k))
      problems.push(`${at}${k}: missing from mirror`);
  }
  for (const k of mirrorKeys) {
    if (!actualKeys.includes(k)) problems.push(`${at}${k}: not a tool input`);
  }
  const actualReq = [...(actual.required ?? [])].sort();
  const mirrorReq = [...(mirror.required ?? [])].sort();
  if (JSON.stringify(actualReq) !== JSON.stringify(mirrorReq)) {
    problems.push(
      `${at}(required): tool [${actualReq.join(", ")}] vs mirror [${mirrorReq.join(", ")}]`
    );
  }
  for (const k of actualKeys.filter((key) => mirrorKeys.includes(key))) {
    const mirrorField = mirror.properties?.[k];
    if (isOpaqueObject(mirrorField)) continue;
    const a = objectShape(actual.properties?.[k], actualRoot);
    const m = objectShape(mirrorField, mirrorRoot);
    if (a && m) {
      problems.push(...diffShapes(a, m, `${at}${k}.`, actualRoot, mirrorRoot));
    } else if (a && !m) {
      problems.push(`${at}${k}: object in tool, not in mirror`);
    } else if (!a && m) {
      problems.push(`${at}${k}: object in mirror, not in tool`);
    }
  }
  return problems;
}

function toolFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return toolFiles(full);
    return name.endsWith(".tool.ts") ? [full] : [];
  });
}

/** Every default-constructible built-in tool, by slug. */
async function loadTools(): Promise<Map<string, Tool<ZodType>>> {
  const bySlug = new Map<string, Tool<ZodType>>();
  for (const file of toolFiles(TOOLS_DIR)) {
    const mod = (await import(pathToFileURL(file).href)) as Record<
      string,
      unknown
    >;
    for (const exported of Object.values(mod)) {
      if (
        typeof exported !== "function" ||
        !(exported.prototype instanceof Tool) ||
        exported.length > 0
      ) {
        continue;
      }
      const tool = new (exported as new () => Tool<ZodType>)();
      bySlug.set(tool.slug, tool);
    }
  }
  return bySlug;
}

const tools = await loadTools();
const mirrored = BUILTIN_TOOLPACKS.flatMap((pack) => pack.tools).filter(
  (t, i, all) => all.findIndex((o) => o.name === t.name) === i
);

describe("built-in toolpack mirror matches each tool's input schema (#615)", () => {
  it("finds a tool class for every mirrored tool", () => {
    const missing = mirrored
      .map((t) => t.name)
      .filter((name) => !tools.has(name));
    expect(missing).toEqual([]);
  });

  it("keeps the exemption list to tools that still exist", () => {
    for (const name of Object.keys(SCHEMA_PARITY_EXEMPT)) {
      expect(mirrored.some((t) => t.name === name)).toBe(true);
    }
  });

  it.each(
    mirrored
      .filter((t) => !(t.name in SCHEMA_PARITY_EXEMPT))
      .map((t) => [t.name, t] as const)
  )("%s", (name, descriptor) => {
    const tool = tools.get(name);
    expect(tool).toBeDefined();
    const actual = z.toJSONSchema(tool!.schema, {
      io: "input",
      unrepresentable: "any",
    }) as JsonSchema;
    const mirror = descriptor.parameterSchema as JsonSchema;
    const problems = diffShapes(actual, mirror, "", actual, mirror);
    expect(problems).toEqual([]);
  });
});
