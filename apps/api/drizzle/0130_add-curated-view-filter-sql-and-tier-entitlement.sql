ALTER TABLE "curated_views" ADD COLUMN "filter_sql" text;--> statement-breakpoint
ALTER TABLE "curated_views" ADD COLUMN "filter_sql_keys" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "advanced_view_filters" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "curated_views" ADD CONSTRAINT "curated_views_filter_mode_exclusive" CHECK ("curated_views"."filter" IS NULL OR "curated_views"."filter_sql" IS NULL);