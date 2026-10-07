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
 * map blocks in a conversation). Soft-deleted rows are skipped.
 *
 * Each SQL runs through `validatePortalSql` (the #660 gate's shape checks),
 * then every relation it names is classified against the row's own org:
 *   - `_meta_entities` / `_meta_columns`, or a curated-view key in the org → ok
 *   - `er__<id>` of an entity in the SAME org → physical (bypasses views)
 *   - `er__<id>` of an entity in ANOTHER org → CROSS-ORG (escalate)
 *   - any other real table/view in the database → physical
 *   - anything else → unknown (a since-deleted view, or a CTE the parser
 *     missed); listed for a human look
 * A pipeline passes only when it validates and every relation is ok.
 *
 * Writes nothing. Two ways to feed it:
 *   - DATABASE_URL=… npx tsx src/scripts/scan-pinned-pipelines.ts [--json out.json]
 *   - --from-dir <dir>: JSON exports of the same five reads (pins.json,
 *     blocks.json, physical.json, entities.json, views.json), e.g. taken with
 *     `portalops db psql --env <env> -- -tAqc "select json_agg(…)"`, so no
 *     database credential leaves the CLI. The queries are the ones in
 *     `loadFromDb` below.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

import { validatePortalSql } from "../services/portal-sql-validation.util.js";

type Verdict = "pass" | "reject";
type RelationClass = "ok" | "physical" | "cross-org" | "unknown";

interface Finding {
  source: "pin" | "message-block";
  id: string;
  blockIndex?: number;
  organizationId: string;
  createdBy: string;
  verdict: Verdict;
  reason?: string;
  relations: { name: string; class: RelationClass; ownerOrgId?: string }[];
}

const META_VIEWS = new Set(["_meta_entities", "_meta_columns"]);
const WIDE_TABLE = /^er__([0-9a-f-]{36})$/;

interface PipelineRow {
  id: string;
  organization_id: string;
  created_by: string;
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

async function loadFromDb(url: string): Promise<ScanInput> {
  const sql = postgres(url, { max: 1 });
  try {
    // Belt and braces: the session refuses any write.
    await sql`set session characteristics as transaction read only`;
    const pins = await sql<PipelineRow[]>`
      select id, organization_id, created_by,
             content->'pipeline'->>'sql' as pipeline_sql
      from portal_results
      where deleted is null and content->'pipeline'->>'sql' is not null`;
    const blocks = await sql<PipelineRow[]>`
      select m.id, m.organization_id, m.created_by,
             (b.ordinality - 1)::int as block_index,
             coalesce(b.block->'content'->'pipeline'->>'sql',
                      b.block->'pipeline'->>'sql') as pipeline_sql
      from portal_messages m,
           jsonb_array_elements(m.blocks) with ordinality as b(block, ordinality)
      where m.deleted is null
        and jsonb_typeof(m.blocks) = 'array'
        and coalesce(b.block->'content'->'pipeline'->>'sql',
                     b.block->'pipeline'->>'sql') is not null`;
    // Every relation that exists in the database, outside the catalogs.
    const physical = (
      await sql<{ relname: string }[]>`
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p','v','m','f')
          and n.nspname not in ('pg_catalog','information_schema','pg_toast')`
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
  const read = <T>(name: string): T =>
    JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
  return {
    pins: read("pins.json"),
    blocks: read("blocks.json"),
    physical: read("physical.json"),
    entities: read("entities.json"),
    views: read("views.json"),
  };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const jsonOut = argValue("--json");
  const fromDir = argValue("--from-dir");
  const url = process.env.DATABASE_URL;
  if (!fromDir && !url)
    throw new Error("DATABASE_URL or --from-dir <dir> is required");
  const input = fromDir ? loadFromDir(fromDir) : await loadFromDb(url!);
  const { pins, blocks } = input;
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
  {
    const classify = (
      rel: string,
      orgId: string
    ): { class: RelationClass; ownerOrgId?: string } => {
      if (META_VIEWS.has(rel)) return { class: "ok" };
      if (viewKeysByOrg.get(orgId)?.has(rel)) return { class: "ok" };
      const wide = WIDE_TABLE.exec(rel);
      if (wide) {
        const owner = entityOrg.get(wide[1]);
        if (owner && owner !== orgId)
          return { class: "cross-org", ownerOrgId: owner };
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
        ...(row.block_index !== undefined
          ? { blockIndex: row.block_index }
          : {}),
        organizationId: row.organization_id,
        createdBy: row.created_by,
      };
      let relations: ReadonlySet<string>;
      try {
        relations = validatePortalSql(row.pipeline_sql).relations;
      } catch (err) {
        findings.push({
          ...base,
          verdict: "reject",
          reason: `gate: ${err instanceof Error ? err.message : String(err)}`,
          relations: [],
        });
        return;
      }
      const classified = [...relations].map((name) => ({
        name,
        ...classify(name, row.organization_id),
      }));
      const bad = classified.filter((r) => r.class !== "ok");
      findings.push({
        ...base,
        verdict: bad.length === 0 ? "pass" : "reject",
        ...(bad.length
          ? { reason: bad.map((r) => `${r.class}: ${r.name}`).join(", ") }
          : {}),
        relations: classified,
      });
    };
    for (const p of pins) scan("pin", p);
    for (const b of blocks) scan("message-block", b);

    const rejected = findings.filter((f) => f.verdict === "reject");
    const crossOrg = rejected.filter((f) =>
      f.relations.some((r) => r.class === "cross-org")
    );
    const summary = {
      scanned: { pins: pins.length, messageBlocks: blocks.length },
      pass: findings.length - rejected.length,
      reject: rejected.length,
      crossOrg: crossOrg.length,
      rejectedByOrg: Object.fromEntries(
        [...new Set(rejected.map((f) => f.organizationId))].map((org) => [
          org,
          rejected.filter((f) => f.organizationId === org).length,
        ])
      ),
    };
    console.log(JSON.stringify(summary, null, 2));
    for (const f of rejected) {
      console.log(
        `${f.verdict.toUpperCase()} ${f.source} ${f.id}${
          f.blockIndex !== undefined ? `#${f.blockIndex}` : ""
        } org=${f.organizationId} by=${f.createdBy} :: ${f.reason}`
      );
    }
    if (jsonOut) {
      writeFileSync(jsonOut, JSON.stringify({ summary, findings }, null, 2));
      console.log(`full findings written to ${jsonOut}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
