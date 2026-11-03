#!/usr/bin/env node
/**
 * Fails when a NEW drizzle migration contains destructive DDL that isn't
 * explicitly acknowledged (#581).
 *
 * Why this exists: a residency install upgrades by applying pending migrations
 * on the customer's own data (`db:upgrade`), forward-only — there is no
 * schema-rollback path. A stray `DROP COLUMN`/`DROP TABLE`/`TRUNCATE`/type
 * change that slips into a migration is therefore irreversible against a
 * customer's data, and nothing else in CI would notice: the migration is valid
 * SQL and the build stays green. This gate makes destructive DDL a DELIBERATE,
 * in-file act — the same "an eslint-disable carries its reason in-file"
 * convention the repo already runs on. Expand-only stays the rule; a genuine
 * post-deprecation cleanup is allowed, but only with a stated reason.
 *
 * It is NOT a block on intent: a destructive statement passes if it carries
 * `-- destructive-ok: <reason>` (non-empty) on the same line or the line above.
 *
 * Grandfathering: the 20 pre-existing migrations with destructive DDL are
 * historical, applied, and immutable. The gate enforces only on migrations
 * indexed above BASELINE_MAX_MIGRATION_INDEX — every future migration is
 * `0096+` and is checked; history (0000–0095) is left untouched.
 *
 * Migration SQL has no natural unit-test surface, so the pure rule runs against
 * embedded synthetic fixtures on every invocation, then against the real tree.
 * `--self-test` runs only the fixtures.
 *
 * A second rule (#952): a new migration may not write the system principal as
 * a literal. Data migrations once wrote 'SYSTEM' or 'system' as `created_by`,
 * but the principal is the environment's SYSTEM_ID (prod's is a UUID), so
 * `created_by_system` grants never matched those rows. Write
 * `portalai_system_id()` (0133) instead. A legitimate `'system'` (a policy or
 * role `kind`) passes with `-- principal-literal-ok: <reason>` on its line or
 * the line above. Migrations up to 0133 (history, and the repair itself) are
 * grandfathered.
 *
 * Usage: npm run lint:migrations [-- --self-test]
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "apps", "api", "drizzle");

/**
 * The highest migration index whose destructive DDL is grandfathered. History
 * (0000–0095) is applied and immutable; every new migration is 0096+ and is
 * enforced. This never needs bumping — new files always sort above it.
 */
const BASELINE_MAX_MIGRATION_INDEX = 95;

/** #952: history and the repair (0133) predate the principal-literal rule. */
const PRINCIPAL_BASELINE_MAX_MIGRATION_INDEX = 133;

/** Destructive DDL patterns, matched case-insensitively per statement-line. */
const DESTRUCTIVE = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { name: "DROP CONSTRAINT", re: /\bDROP\s+CONSTRAINT\b/i },
  { name: "TRUNCATE", re: /\bTRUNCATE\b/i },
  // `SET DATA TYPE` and a bare `TYPE` change both contain `TYPE`; a plain
  // `SET DEFAULT` / `SET NOT NULL` does not, so it isn't flagged.
  { name: "ALTER COLUMN TYPE", re: /\bALTER\s+COLUMN\b.*\bTYPE\b/i },
];

/** A non-empty `-- destructive-ok: <reason>` acknowledgment. */
const ACK = /--\s*destructive-ok:\s*\S/i;

/** Blank out single-quoted string literals so a keyword inside data is ignored. */
function blankStrings(line) {
  return line.replace(/'(?:[^']|'')*'/g, (m) => " ".repeat(m.length));
}

/** Split a line into its code part (before `--`) and whether it carries an ack. */
function splitComment(line) {
  const idx = line.indexOf("--");
  if (idx === -1) return { code: line, ack: false };
  return { code: line.slice(0, idx), ack: ACK.test(line.slice(idx)) };
}

/**
 * Pure rule: return the unacknowledged destructive statements in `sql`.
 * A statement is acknowledged by a `-- destructive-ok: <reason>` on its own
 * line or the line immediately above it. Index-independent — the caller decides
 * which files to run it on.
 */
export function findViolations(sql) {
  const lines = sql.split("\n");
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const { code, ack: sameLineAck } = splitComment(lines[i]);
    const scannable = blankStrings(code);
    const hit = DESTRUCTIVE.find((d) => d.re.test(scannable));
    if (!hit) continue;
    const prevAck = i > 0 && ACK.test(lines[i - 1]);
    if (sameLineAck || prevAck) continue;
    violations.push({ line: i + 1, keyword: hit.name, text: lines[i].trim() });
  }
  return violations;
}

/** The system principal written as a literal, exact case (#952). */
const PRINCIPAL_LITERAL = /'(?:SYSTEM|system)'/;

/** A non-empty `-- principal-literal-ok: <reason>` acknowledgment. */
const PRINCIPAL_ACK = /--\s*principal-literal-ok:\s*\S/i;

/**
 * Pure rule (#952): the lines of `sql` that write `'SYSTEM'` / `'system'`
 * outside a comment, unless acknowledged on that line or the line above.
 */
export function findPrincipalLiterals(sql) {
  const lines = sql.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf("--");
    const code = idx === -1 ? lines[i] : lines[i].slice(0, idx);
    if (!PRINCIPAL_LITERAL.test(code)) continue;
    const ack =
      (idx !== -1 && PRINCIPAL_ACK.test(lines[i].slice(idx))) ||
      (i > 0 && PRINCIPAL_ACK.test(lines[i - 1]));
    if (!ack) hits.push({ line: i + 1, text: lines[i].trim() });
  }
  return hits;
}

/** Numeric index from a `NNNN_name.sql` basename, or null. */
function migrationIndex(basename) {
  const m = /^(\d{4})_/.exec(basename);
  return m ? Number(m[1]) : null;
}

// ── Self-test fixtures (exercise the pure rule) ──────────────────────

const FIXTURES = [
  { name: "unacknowledged DROP COLUMN fails", sql: `ALTER TABLE "t" DROP COLUMN "c";`, expect: 1 },
  {
    name: "acknowledged (line above) passes",
    sql: `-- destructive-ok: removing legacy column after the deprecation window\nALTER TABLE "t" DROP COLUMN "c";`,
    expect: 0,
  },
  {
    name: "acknowledged (trailing) passes",
    sql: `ALTER TABLE "t" DROP COLUMN "c"; -- destructive-ok: legacy`,
    expect: 0,
  },
  { name: "empty-reason marker fails", sql: `-- destructive-ok:\nDROP TABLE "t";`, expect: 1 },
  {
    name: "additive migration passes",
    sql: `CREATE TABLE "t" ("id" text);\nALTER TABLE "t" ADD COLUMN "c" text;\nALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;`,
    expect: 0,
  },
  { name: "TRUNCATE flagged", sql: `TRUNCATE TABLE "t";`, expect: 1 },
  { name: "DROP CONSTRAINT flagged", sql: `ALTER TABLE "t" DROP CONSTRAINT "t_c_key";`, expect: 1 },
  { name: "type change flagged", sql: `ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE integer;`, expect: 1 },
  {
    name: "keyword inside a string is not flagged",
    sql: `INSERT INTO "t" ("note") VALUES ('remember to DROP TABLE later');`,
    expect: 0,
  },
  // #952: the principal-literal rule.
  {
    rule: "principal",
    name: "a 'SYSTEM' creator in VALUES fails",
    sql: `INSERT INTO "t" ("id", "created_by") VALUES ('x', 'SYSTEM');`,
    expect: 1,
  },
  {
    rule: "principal",
    name: "a 'system' creator from SELECT fails",
    sql: `INSERT INTO "t" ("id", "created_by")\nSELECT o.id, 'system' FROM "organizations" o;`,
    expect: 1,
  },
  {
    rule: "principal",
    name: "an acknowledged kind = 'system' passes",
    sql: `-- principal-literal-ok: a policy kind, not a creator\nWHERE p."kind" = 'system'`,
    expect: 0,
  },
  {
    rule: "principal",
    name: "an empty-reason principal ack fails",
    sql: `WHERE p."kind" = 'system' -- principal-literal-ok:`,
    expect: 1,
  },
  {
    rule: "principal",
    name: "portalai_system_id() passes",
    sql: `INSERT INTO "t" ("id", "created_by") VALUES ('x', portalai_system_id());`,
    expect: 0,
  },
];

function runSelfTest() {
  const failures = [];
  for (const f of FIXTURES) {
    const rule = f.rule === "principal" ? findPrincipalLiterals : findViolations;
    const got = rule(f.sql).length;
    if (got !== f.expect) failures.push(`  ✗ ${f.name}: expected ${f.expect} violation(s), got ${got}`);
  }
  if (failures.length > 0) {
    console.error(`self-test: ${failures.length} of ${FIXTURES.length} fixture(s) failed`);
    console.error(failures.join("\n"));
    return false;
  }
  console.log(`self-test: ${FIXTURES.length} fixture(s) passed`);
  return true;
}

function runRealTree() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const problems = [];
  const principal = [];
  for (const file of files) {
    const idx = migrationIndex(file);
    if (idx === null || idx <= BASELINE_MAX_MIGRATION_INDEX) continue; // grandfathered
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const v of findViolations(sql)) {
      problems.push(`  ${file}:${v.line}  [${v.keyword}]  ${v.text}`);
    }
    if (idx > PRINCIPAL_BASELINE_MAX_MIGRATION_INDEX) {
      for (const v of findPrincipalLiterals(sql)) {
        principal.push(`  ${file}:${v.line}  ${v.text}`);
      }
    }
  }
  if (principal.length > 0) {
    console.error(
      `lint:migrations: ${principal.length} literal system principal(s) in new migrations:\n` +
        principal.join("\n") +
        `\n\nThe principal is the environment's SYSTEM_ID, not 'SYSTEM'/'system' (#952).\n` +
        `Write created_by as portalai_system_id(). For a 'system' that isn't a principal\n` +
        `(e.g. kind = 'system'), add \`-- principal-literal-ok: <reason>\` on the line or the line above.`
    );
    return false;
  }
  if (problems.length > 0) {
    console.error(
      `lint:migrations: ${problems.length} unacknowledged destructive statement(s) in new migrations:\n` +
        problems.join("\n") +
        `\n\nEach is irreversible against a customer's data on upgrade (forward-only).\n` +
        `If intended, add \`-- destructive-ok: <reason>\` on the statement or the line above.`
    );
    return false;
  }
  console.log(
    `lint:migrations: no unacknowledged destructive DDL in migrations > ${BASELINE_MAX_MIGRATION_INDEX}, ` +
      `no literal system principal in migrations > ${PRINCIPAL_BASELINE_MAX_MIGRATION_INDEX}`
  );
  return true;
}

const selfTestOnly = process.argv.includes("--self-test");
const ok = runSelfTest() && (selfTestOnly || runRealTree());
process.exit(ok ? 0 : 1);
