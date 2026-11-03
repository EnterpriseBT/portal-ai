-- #952: relabel the literal system principal the earlier data migrations
-- wrote ('SYSTEM' in 0065/0066/0080; 'system' in 0102/0104/0106/0110/0111/
-- 0116/0129) and CLI-spawned scripts wrote (runApiScript passed no SYSTEM_ID,
-- so `portalai demo seed --env prod` labeled prod's whole Demo org 'SYSTEM').
-- `created_by_system` grants match only createdBy === SystemUtilities.id.system
-- (permission-set.ts), so in an env whose SYSTEM_ID isn't 'SYSTEM' (prod: a
-- UUID) those rows were nobody's.
--
-- portalai_system_id() is the principal every runner passes as the
-- `portalai.system_id` startup setting (db-migrate.ts, the integration setup).
-- It raises when unset, so a runner that forgot it fails this batch instead
-- of marking the repair applied. Later data migrations write created_by as
-- portalai_system_id(), never a literal (`npm run lint:migrations`).
--
-- Rule: every public table with a created_by / updated_by / deleted_by
-- column, `SET col = principal WHERE col IN ('SYSTEM','system')` and it
-- differs. Idempotent; a no-op where the principal is already 'SYSTEM'
-- (app-dev, local). Excluded:
--   entity_records, er__*  : provenance-only parts of an entity (#829), and
--                            large (253,595 prod Demo rows); no access change.
--   audit_log              : a record of truth, and append-only: its trigger
--                            (0096) raises on UPDATE.
--   commercial_events,
--   tool_usage_ledger      : records of truth; history isn't rewritten.
-- Before-state: the 2026-11-03 audit on #952 (every rewritten value was one
-- of the two literals).
-- principal-literal-ok: matches the literals 0065–0129 wrote
CREATE OR REPLACE FUNCTION portalai_system_id() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  principal text := nullif(btrim(current_setting('portalai.system_id', true)), '');
BEGIN
  IF principal IS NULL THEN
    RAISE EXCEPTION 'portalai.system_id is not set: run migrations through db-migrate (#952)';
  END IF;
  RETURN principal;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  principal text := portalai_system_id();
  col record;
BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('created_by', 'updated_by', 'deleted_by')
      AND c.table_name NOT LIKE 'er\_\_%'
      AND c.table_name NOT IN (
        'entity_records', 'audit_log', 'commercial_events', 'tool_usage_ledger'
      )
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      -- principal-literal-ok: the comparison side of the repair
      'UPDATE %I SET %I = $1 WHERE %I IN (''SYSTEM'', ''system'') AND %I IS DISTINCT FROM $1',
      col.table_name, col.column_name, col.column_name, col.column_name
    ) USING principal;
  END LOOP;
END;
$$;
