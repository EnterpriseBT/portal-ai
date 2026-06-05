/**
 * Split a SQL projection string (the comma-separated list inside a
 * SELECT clause) into `{ value, alias }` pairs.
 *
 * Used by the bulk_transform processor (#85 Phase 2) — the agent's
 * `expression.value` is a projection like
 *   `("c_a" + "c_b") / 2.0 AS c_avg, UPPER("c_name") AS c_label`
 * and we need to emit:
 *   - INSERT column list: the alias names
 *   - SELECT value list: the expression values
 * separately, because PG's INSERT column list rejects expressions.
 *
 * The parser respects:
 *   - Top-level commas only (commas inside parens or string literals
 *     do not split).
 *   - Top-level `AS` only (the same — inside subqueries it would not
 *     be split correctly here, which is fine for the constrained
 *     projection grammar we accept).
 *   - Both quoted (`"c_x"`) and unquoted aliases.
 *
 * It does NOT validate the value side — pg's EXPLAIN already did
 * that during the tool's pre-flight. The parser just slices the
 * already-validated string.
 */

export interface Projection {
  /** The expression to the left of `AS`. */
  value: string;
  /** The unquoted column name to the right of `AS`. */
  alias: string;
}

export function parseProjections(input: string): Projection[] {
  const segments = splitTopLevelCommas(input);
  return segments.map((seg) => parseOneProjection(seg));
}

function parseOneProjection(segment: string): Projection {
  const asIdx = findLastTopLevelAs(segment);
  if (asIdx === -1) {
    throw new Error(
      `bulk_transform expression segment is missing an AS alias: ${segment.trim()}`
    );
  }
  const value = segment.slice(0, asIdx).trim();
  const aliasRaw = segment.slice(asIdx + 2).trim();
  const alias = stripQuotes(aliasRaw);
  if (!alias) {
    throw new Error(
      `bulk_transform expression segment has empty alias: ${segment.trim()}`
    );
  }
  return { value, alias };
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

/**
 * Split `input` on commas that appear at parenthesis depth 0 and
 * outside string literals.
 */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inSingle) {
      buf += ch;
      if (ch === "'" && input[i + 1] === "'") {
        // escaped single quote — consume next
        buf += input[++i];
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      buf += ch;
      if (ch === '"' && input[i + 1] === '"') {
        buf += input[++i];
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}

/**
 * Find the index of the last whitespace-delimited `AS` keyword at
 * parenthesis depth 0 + outside string literals. Returns the index
 * of the `A` in `AS`, or -1 when no top-level AS exists.
 */
function findLastTopLevelAs(input: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let lastAs = -1;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'" && input[i + 1] === "'") {
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '"' && input[i + 1] === '"') {
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (
      (ch === "a" || ch === "A") &&
      (input[i + 1] === "s" || input[i + 1] === "S") &&
      isAsWordBoundary(input, i, i + 2)
    ) {
      lastAs = i;
      i++;
    }
  }
  return lastAs;
}

function isAsWordBoundary(s: string, start: number, end: number): boolean {
  const before = start === 0 ? " " : s[start - 1];
  const after = end >= s.length ? " " : s[end];
  return /\s/.test(before) && /\s/.test(after);
}
