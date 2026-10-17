-- #649: trigram indexes for curated-view text search. The wide-table
-- reconciler builds a `gin_trgm_ops` index on each `text` c_* column at add,
-- and the wide-table-search-index sweep builds them on existing tables
-- (CONCURRENTLY, outside any migration). Both need the extension present.
--
-- pg_trgm is a trusted extension (PG13+), so the database owner can create it
-- without superuser. Idempotent by `IF NOT EXISTS`: on a managed database it
-- may be pre-created out-of-band, in which case this is a no-op. It ships in
-- Postgres contrib, which the compose/Helm PostGIS images include.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
