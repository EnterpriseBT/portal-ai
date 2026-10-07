/**
 * #665: read-only scan of every stored pipeline SQL saved before #660.
 *
 * Before #660 a pinned pipeline only had to pass the old regex gate, so a
 * stored query could read a physical table (`er__<entityId>`,
 * `entity_records`, any app table) instead of the caller's curated views.
 * #660 makes such pipelines serve nothing now; this classifies what is still
 * stored, so the incident follow-up knows what was read and by whom.
 *
 * Sources: `portal_results.content.pipeline.sql` (pins) and
 * `portal_messages.blocks[].content.pipeline.sql` (refreshable widgets and
 * map blocks in a conversation). Soft-deleted rows are included and flagged:
 * a pipeline deleted after the fact still ran and served rows before then.
 *
 * Each SQL is parsed, and every relation it names (plain or
 * schema-qualified) is classified against the row's own org, whatever the
 * #660 gate (`validatePortalSql`) decides; the gate's verdict is recorded
 * beside it. So a query the gate refuses for its shape (e.g.
 * `public.er__<other org>`) is still caught as cross-org.
 *   - `_meta_*` session views, or a curated-view key in the org → ok
 *   - `er__<id>` of an entity in the SAME org → physical (bypasses views)
 *   - `er__<id>` of an entity in ANOTHER org → cross-org (escalate)
 *   - `er__<id>` whose entity no longer exists → unknown (owner unresolved)
 *   - a `pg_catalog` / `information_schema` relation → catalog
 *   - any other real table or view in the database → physical
 *   - anything else → unknown (a since-deleted view, say); for a human look
 * A pipeline passes only when the gate accepts it and every relation is ok.
 *
 * Limit: "ok" means the view is one of the ORG's curated views. Whether the
 * pin's author was granted that view is not checked (that needs each user's
 * resolved permission set); the #660 gate enforces it at serve time.
 *
 * Writes nothing. Two ways to feed it:
 *   - DATABASE_URL=… npx tsx src/scripts/scan-pinned-pipelines.ts [--json out.json]
 *   - --from-dir <dir>: JSON exports of the same five reads (pins.json,
 *     blocks.json, physical.json, entities.json, views.json), e.g. taken with
 *     `portalops db psql --env <env> -- -tAqc "select coalesce(json_agg(…),'[]')"`,
 *     so no database credential leaves the CLI. The queries are the ones in
 *     `loadFromDb` below.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

import { validatePortalSql } from "../services/portal-sql-validation.util.js";
import { parsePortalSql } from "../services/portal-sql-parse.util.js";

type Verdict = "pass" | "reject";
type RelationClass = "ok" | "physical" | "cross-org" | "catalog" | "unknown";

interface PipelineRow {
  id: string;
  organization_id: string;
  created_by: string;
  deleted: boolean;
  pipeline_sql: string;
  block_index?: number;
}

interface ScanInput {
  pins: PipelineRow[];
  blocks: PipelineRow[];
  physical: string[];
  entities: { id: string; organization_id: string }[];
  views: { organization_id: string; key: string }[];
}

interface Finding {
  source: "pin" | "message-block";
  id: string;
  blockIndex?: number;
  organizationId: string;
  createdBy: string;
  deleted: boolean;
  verdict: Verdict;
  /** The #660 gate's refusal, when it refuses (null = the gate accepts). */
  gateError: string | null;
  reason?: string;
  relations: { name: string; class: RelationClass; ownerOrgId?: string }[];
}

/** The session views every build emits (`PortalSqlService`), not data. */
const META_VIEWS = new Set([
  "_meta_entities",
  "_meta_columns",
  "_meta_column_catalog",
]);
const CATALOG_SCHEMAS = new Set(["pg_catalog", "information_schema"]);
const WIDE_TABLE = /^er__([0-9a-f-]{36})$/;

const PIPELINE_SQL = `coalesce(b.block->'content'->'pipeline'->>'sql', b.block->'pipeline'->>'sql')`;

async function loadFromDb(url: string): Promise<ScanInput> {
  const sql = postgres(url, { max: 1 });
  try {
    // Belt and braces: the session refuses any write.
    await sql`set session characteristics as transaction read only`;
    const pins = await sql<PipelineRow[]>`
      select id, organization_id, created_by, deleted is not null as deleted,
             content->'pipeline'->>'sql' as pipeline_sql
      from portal_results
      where content->'pipeline'->>'sql' is not null`;
    const blocks = await sql<PipelineRow[]>`
      select m.id, m.organization_id, m.created_by,
             m.deleted is not null as deleted,
             (b.ordinality - 1)::int as block_index,
             ${sql.unsafe(PIPELINE_SQL)} as pipeline_sql
      from portal_messages m,
           jsonb_array_elements(m.blocks) with ordinality as b(block, ordinality)
      where jsonb_typeof(m.blocks) = 'array'
        and ${sql.unsafe(PIPELINE_SQL)} is not null`;
    // Every persistent relation outside the catalogs. Temp schemas are left
    // out: they hold other live sessions' views, which aren't real tables.
    const physical = (
      await sql<{ relname: string }[]>`
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p','v','m','f')
          and n.nspname not in ('pg_catalog','information_schema')
          and n.nspname not like 'pg_toast%'
          and n.nspname not like 'pg_temp%'`
    ).map((r) => r.relname);
    const entities = await sql<{ id: string; organization_id: string }[]>`
      select id, organization_id from connector_entities`;
    const views = await sql<{ organization_id: string; key: string }[]>`
      select organization_id, key from curated_views where deleted is null`;
    return { pins, blocks, physical, entities, views };
  } finally {
    await sql.end();
  }
}

function loadFromDir(dir: string): ScanInput {
  // `json_agg` over an empty set is `null`; read it as an empty list.
  const read = <T>(name: string): T[] =>
    (JSON.parse(readFileSync(join(dir, name), "utf8")) as T[] | null) ?? [];
  return {
    pins: read("pins.json"),
    blocks: read("blocks.json"),
    physical: read("physical.json"),
    entities: read("entities.json"),
    views: read("views.json"),
  };
}

/** A flag's value; a missing one (or another flag in its place) is an error. */
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} needs a value`);
  return value;
}

async function main() {
  const jsonOut = argValue("--json");
  const fromDir = argValue("--from-dir");
  const url = process.env.DATABASE_URL;
  if (!fromDir && !url)
    throw new Error("DATABASE_URL or --from-dir <dir> is required");
  const input = fromDir ? loadFromDir(fromDir) : await loadFromDb(url!);

  const physical = new Set(input.physical);
  const entityOrg = new Map(
    input.entities.map((r) => [r.id, r.organization_id])
  );
  const viewKeysByOrg = new Map<string, Set<string>>();
  for (const r of input.views) {
    const set = viewKeysByOrg.get(r.organization_id) ?? new Set<string>();
    set.add(r.key);
    viewKeysByOrg.set(r.organization_id, set);
  }

  const classify = (
    rel: string,
    orgId: string
  ): { class: RelationClass; ownerOrgId?: string } => {
    if (META_VIEWS.has(rel)) return { class: "ok" };
    if (viewKeysByOrg.get(orgId)?.has(rel)) return { class: "ok" };
    const wide = WIDE_TABLE.exec(rel);
    if (wide) {
      const owner = entityOrg.get(wide[1]);
      if (!owner) return { class: "unknown" }; // entity gone: owner unresolved
      if (owner !== orgId) return { class: "cross-org", ownerOrgId: owner };
      return { class: "physical", ownerOrgId: owner };
    }
    if (physical.has(rel)) return { class: "physical" };
    return { class: "unknown" };
  };

  const findings: Finding[] = [];
  const scan = (source: Finding["source"], row: PipelineRow) => {
    const base = {
      source,
      id: row.id,
      ...(row.block_index !== undefined ? { blockIndex: row.block_index } : {}),
      organizationId: row.organization_id,
      createdBy: row.created_by,
      deleted: row.deleted,
    };
    let gateError: string | null = null;
    try {
      validatePortalSql(row.pipeline_sql);
    } catch (err) {
      gateError = err instanceof Error ? err.message : String(err);
    }
    // Classify what the SQL names whatever the gate says: a shape refusal
    // (schema-qualified, a disallowed function) must not hide a cross-org read.
    let parsed: ReturnType<typeof parsePortalSql>;
    try {
      parsed = parsePortalSql(row.pipeline_sql);
    } catch (err) {
      findings.push({
        ...base,
        verdict: "reject",
        gateError,
        reason: `unparseable: ${err instanceof Error ? err.message : String(err)}`,
        relations: [],
      });
      return;
    }
    // A qualified relation also appears unqualified in `relations`; report it
    // once, under its qualified name.
    const qualifiedNames = new Set(
      parsed.qualifiedRelations.map((q) => q.slice(q.lastIndexOf(".") + 1))
    );
    const relations: Finding["relations"] = [...parsed.relations]
      .filter((name) => !qualifiedNames.has(name))
      .map((name) => ({ name, ...classify(name, row.organization_id) }));
    for (const qualified of parsed.qualifiedRelations) {
      const dot = qualified.lastIndexOf(".");
      const schema = qualified.slice(0, dot);
      const relname = qualified.slice(dot + 1);
      relations.push(
        CATALOG_SCHEMAS.has(schema)
          ? { name: qualified, class: "catalog" }
          : { name: qualified, ...classify(relname, row.organization_id) }
      );
    }
    const bad = relations.filter((r) => r.class !== "ok");
    const reasons = [
      ...(gateError ? [`gate: ${gateError}`] : []),
      ...bad.map((r) => `${r.class}: ${r.name}`),
    ];
    findings.push({
      ...base,
      verdict: reasons.length === 0 ? "pass" : "reject",
      gateError,
      ...(reasons.length ? { reason: reasons.join(", ") } : {}),
      relations,
    });
  };
  for (const p of input.pins) scan("pin", p);
  for (const b of input.blocks) scan("message-block", b);

  const rejected = findings.filter((f) => f.verdict === "reject");
  const rejectedByOrg: Record<string, number> = {};
  for (const f of rejected)
    rejectedByOrg[f.organizationId] =
      (rejectedByOrg[f.organizationId] ?? 0) + 1;
  const summary = {
    scanned: {
      pins: input.pins.length,
      messageBlocks: input.blocks.length,
      softDeleted: findings.filter((f) => f.deleted).length,
    },
    pass: findings.length - rejected.length,
    reject: rejected.length,
    crossOrg: rejected.filter((f) =>
      f.relations.some((r) => r.class === "cross-org")
    ).length,
    rejectedByOrg,
    note: "ok = a curated view of the row's org; per-user grants are not checked (the #660 gate enforces them at serve time)",
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const f of rejected) {
    console.log(
      `REJECT ${f.source} ${f.id}${
        f.blockIndex !== undefined ? `#${f.blockIndex}` : ""
      }${f.deleted ? " (deleted)" : ""} org=${f.organizationId} by=${
        f.createdBy
      } :: ${f.reason}`
    );
  }
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ summary, findings }, null, 2));
    console.log(`full findings written to ${jsonOut}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
