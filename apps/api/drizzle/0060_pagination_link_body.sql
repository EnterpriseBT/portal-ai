-- API connector — widens the pagination CHECK constraint to admit the
-- new `linkBody` strategy. The `linkBody` iterator reads the next URL
-- from a dotted path in the response body and follows it verbatim,
-- mirroring `linkHeader` but for upstreams (like NASA NEO) that put
-- the next link in the body instead of the HTTP `Link` header.
--
-- No data migration: existing rows all carry one of the four prior
-- strategies, which the wider constraint still admits.

ALTER TABLE "api_endpoint_configs"
  DROP CONSTRAINT IF EXISTS "api_endpoint_configs_pagination_check";--> statement-breakpoint
ALTER TABLE "api_endpoint_configs"
  ADD CONSTRAINT "api_endpoint_configs_pagination_check"
  CHECK ("pagination" IN ('none', 'pageOffset', 'cursor', 'linkHeader', 'linkBody'));
