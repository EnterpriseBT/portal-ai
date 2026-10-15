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

function joinPath(parent: string, segment: string): string {
  return parent === "" ? segment : `${parent}.${segment}`;
}

/**
 * Where the first U+0000 sits in a JSON-shaped value, in document order, or
 * null if there is none. Checks object keys and string values through objects
 * and arrays. Iterative, so depth can't overflow the stack. Segments join
 * with "." (`data.notes`, `items.2.name`), as `describeFirstZodIssue` does; a
 * NUL in a key reports the parent path plus the stripped key. "" means the
 * value itself is the string.
 */
export function findNul(value: unknown): { path: string } | null {
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: "" }];
  while (stack.length > 0) {
    const { value: current, path } = stack.pop()!;
    if (typeof current === "string") {
      if (current.includes(NUL)) return { path: capPath(path) };
      continue;
    }
    if (!isWalkable(current)) continue;
    const children: Array<{ value: unknown; path: string }> = [];
    if (Array.isArray(current)) {
      current.forEach((item, i) =>
        children.push({ value: item, path: joinPath(path, String(i)) })
      );
    } else {
      for (const key of Object.keys(current)) {
        const childPath = joinPath(path, stripNul(key));
        if (key.includes(NUL)) return { path: capPath(childPath) };
        children.push({ value: current[key], path: childPath });
      }
    }
    // Reversed, so the stack pops them in document order.
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
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
