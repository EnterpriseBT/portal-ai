-- API connector — Phase 3 widens the pagination CHECK constraint.
--
-- Phase 1 pinned `pagination = 'none'`; phase 3 opens it to the closed
-- set {'none','pageOffset','cursor','linkHeader'} so the adapter can
-- drive per-strategy iterators against the existing columns.
--
-- No data migration is required: phase 1 rows all have
-- `pagination = 'none'`, which satisfies the wider CHECK.
--
-- See `docs/API_CONNECTOR_PHASE_3.spec.md` for the full contract.

ALTER TABLE "api_endpoint_configs"
  DROP CONSTRAINT IF EXISTS "api_endpoint_configs_pagination_phase1_check";--> statement-breakpoint
ALTER TABLE "api_endpoint_configs"
  ADD CONSTRAINT "api_endpoint_configs_pagination_check"
  CHECK ("pagination" IN ('none', 'pageOffset', 'cursor', 'linkHeader'));
