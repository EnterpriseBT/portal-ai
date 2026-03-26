ALTER TABLE "stations" ADD COLUMN "tool_packs" jsonb NOT NULL DEFAULT '["data_query"]'::jsonb;
