/**
 * JSONata transform utility. Evaluates a user-supplied expression
 * against the raw HTTP response body and coerces the result into a
 * flat records array suitable for downstream inference + sync.
 *
 * Stays a pure leaf: no logging, no I/O, no globals. Parse and runtime
 * errors are classified and returned in the result; the function never
 * throws.
 *
 * Result-shape coercion follows these rules:
 *   - array               → records = the array
 *   - object              → records = [the object]   (wrap-to-array)
 *   - primitive (number,  → records = [{ value: prim }]
 *     string, boolean)
 *   - null / undefined    → records = []
 *
 * The wrap-to-array rules exist because JSONata's "sequence vs
 * singleton" semantics collapse a single result to its own type
 * (e.g. an expression that targets exactly one object returns the
 * object directly, not a one-element array). Downstream inference
 * always wants `unknown[]`; this util is the bottleneck that
 * enforces the shape.
 */
import jsonata from "jsonata";

export interface TransformResult {
  records: unknown[];
  /** null on success; populated on parse or runtime failure. */
  error: { kind: "parse" | "runtime"; message: string } | null;
}

export async function applyTransform(
  expression: string,
  response: unknown
): Promise<TransformResult> {
  if (!expression || expression.trim() === "") {
    return {
      records: [],
      error: { kind: "parse", message: "Expression is empty" },
    };
  }

  let compiled: ReturnType<typeof jsonata>;
  try {
    compiled = jsonata(expression);
  } catch (err) {
    return {
      records: [],
      error: { kind: "parse", message: errorMessage(err) },
    };
  }

  let evaluated: unknown;
  try {
    evaluated = await compiled.evaluate(response);
  } catch (err) {
    return {
      records: [],
      error: { kind: "runtime", message: errorMessage(err) },
    };
  }

  return { records: coerceToRecords(evaluated), error: null };
}

function coerceToRecords(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  // JSONata's `.{ ... }` projection returns a "sequence" — an Array
  // subclass with a `.sequence = true` enumerable property. Spreading
  // strips the extra key so callers (and Jest's strict deep-equality)
  // see a plain Array.
  if (Array.isArray(value)) return [...value];
  if (typeof value === "object") return [value];
  return [{ value }];
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}
