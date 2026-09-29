-- destructive-ok: #599 curated_views.where_clause is an unused column (nothing writes it as of slice 3); replaced by the structured `filter` jsonb (a FilterGroup, filter.contract.ts)
ALTER TABLE "curated_views" DROP COLUMN "where_clause";--> statement-breakpoint
ALTER TABLE "curated_views" ADD COLUMN "filter" jsonb;
