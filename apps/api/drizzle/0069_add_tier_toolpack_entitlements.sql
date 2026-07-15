ALTER TABLE "tiers" ADD COLUMN "builtin_toolpacks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "custom_toolpacks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-added backfill (#214): every pre-existing tier row goes fully
-- permissive — deploy day is zero behavior change. Future rows get the
-- fail-closed column defaults and must declare entitlements explicitly.
-- Slug list mirrors BuiltinToolpackSlugSchema in
-- packages/core/src/registries/builtin-toolpacks.ts (keep in sync).
UPDATE "tiers" SET
  "builtin_toolpacks" = '["data_query","statistics","regression","financial","web_search","entity_management"]'::jsonb,
  "custom_toolpacks" = true;
