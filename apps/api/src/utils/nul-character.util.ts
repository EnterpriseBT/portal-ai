/**
 * U+0000 handling (#805). JSON and URLs can carry a NUL (`"\u0000"`, `%00`),
 * but no Postgres `text` or `jsonb` value can hold one: `text` refuses it with
 * `22021` and `jsonb` with `22P05`. A request carrying one is refused at the
 * boundary (`reject-nul.middleware.ts`), agent tool input likewise
 * (`input-character-gate.service.ts`), and imported data has it stripped.
 * These are the shared primitives for all three.
 */

const NUL = "\u0000";

/** Longest JSON path echoed in a refusal; longer paths are cut with "…", so
 *  the response can't scale with a caller-controlled key (#745). */
export const MAX_NUL_PATH_LENGTH = 200;

/** Plain JSON-shaped containers are walked; anything else (a Date, a Buffer)
 *  is a leaf, since it can't carry a NUL into a text or jsonb value. */
function isWalkable(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function capPath(path: string): string {
  return path.length > MAX_NUL_PATH_LENGTH
    ? `${path.slice(0, MAX_NUL_PATH_LENGTH - 1)}…`
    : path;
}

/** One node of `findNul`'s walk. The path is only built on a hit, from the
 *  parent chain, so a clean walk allocates no strings. */
interface WalkEntry {
  value: unknown;
  /** The key or index this value sits under; null at the root. */
  segment: string | null;
  parent: WalkEntry | null;
}

function pathOf(entry: WalkEntry): string {
  const segments: string[] = [];
  for (let e: WalkEntry | null = entry; e?.segment != null; e = e.parent) {
    segments.push(stripNul(e.segment));
  }
  return capPath(segments.reverse().join("."));
}

/**
 * Where the first U+0000 sits in a JSON-shaped value, in document order, or
 * null if there is none. Checks object keys and string values through objects
 * and arrays. Iterative, so depth can't overflow the stack, and the path is
 * only built for a hit (this runs on every request body and tool call).
 * Segments join with "." (`data.notes`, `items.2.name`), as
 * `describeFirstZodIssue` does; a NUL in a key reports the path to that key,
 * stripped. "" means the value itself is the string.
 */
export function findNul(value: unknown): { path: string } | null {
  const stack: WalkEntry[] = [{ value, segment: null, parent: null }];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.segment?.includes(NUL)) return { path: pathOf(entry) };
    const current = entry.value;
    if (typeof current === "string") {
      if (current.includes(NUL)) return { path: pathOf(entry) };
      continue;
    }
    if (!isWalkable(current)) continue;
    // Pushed in reverse, so the stack pops them in document order.
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) {
        stack.push({ value: current[i], segment: String(i), parent: entry });
      }
    } else {
      const keys = Object.keys(current);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i]!;
        stack.push({ value: current[key], segment: key, parent: entry });
      }
    }
  }
  return null;
}

/** `s` without any U+0000. */
export function stripNul(s: string): string {
  return s.includes(NUL) ? s.split(NUL).join("") : s;
}

/**
 * A copy of `value` with U+0000 removed from every key and string, and how
 * many strings changed. Returns `value` itself and 0 when there is no NUL, so
 * the clean path allocates nothing. Copies are plain objects (never
 * null-prototype, which Drizzle can't introspect), keys are defined rather
 * than assigned (a `__proto__` key stays an own property), and when stripping
 * makes two keys collide the later one wins. Iterative, like `findNul`.
 */
export function stripNulDeep<T>(value: T): { value: T; stripped: number } {
  if (findNul(value) === null) return { value, stripped: 0 };

  let stripped = 0;
  const stripString = (s: string): string => {
    if (!s.includes(NUL)) return s;
    stripped++;
    return stripNul(s);
  };
  const pending: Array<[unknown, Record<string, unknown> | unknown[]]> = [];
  const copy = (v: unknown): unknown => {
    if (typeof v === "string") return stripString(v);
    if (!isWalkable(v)) return v;
    const target: Record<string, unknown> | unknown[] = Array.isArray(v)
      ? []
      : {};
    pending.push([v, target]);
    return target;
  };

  const root = copy(value);
  while (pending.length > 0) {
    const [source, target] = pending.pop()!;
    if (Array.isArray(source)) {
      source.forEach((item, i) => {
        (target as unknown[])[i] = copy(item);
      });
    } else {
      const record = source as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        Object.defineProperty(target, stripString(key), {
          value: copy(record[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
  }
  return { value: root as T, stripped };
}
