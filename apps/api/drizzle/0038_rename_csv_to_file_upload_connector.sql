-- Migrate the legacy "csv" connector definition to the unified "file-upload"
-- identity. The connector now accepts both CSV and XLSX files through a single
-- workflow; the slug + display are updated to reflect that.
--
-- This is a data-only migration: the auto-generated UUID `id` is unchanged, so
-- existing rows in `connector_instances` (which reference the definition by id)
-- remain valid without further updates.
UPDATE "connector_definitions"
SET "slug" = 'file-upload',
    "display" = 'File Upload',
    "updated" = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
WHERE "slug" = 'csv';
