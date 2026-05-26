-- API connector — adds an optional `transform` column to
-- `api_endpoint_configs`. Holds a JSONata expression applied to the raw
-- HTTP response before inference / sync. Mutually exclusive with
-- `records_path` (enforced in the application layer via the Zod
-- refinement on `ApiEndpointConfigSchema`, not as a DB constraint —
-- the choice is per-endpoint and the schema layer is the source of
-- truth).
--
-- Nullable; existing rows are unaffected.

ALTER TABLE "api_endpoint_configs" ADD COLUMN "transform" text;
