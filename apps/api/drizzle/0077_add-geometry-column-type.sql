CREATE TYPE "public"."geo_role" AS ENUM('lat', 'lng');--> statement-breakpoint
ALTER TYPE "public"."column_data_type" ADD VALUE 'geometry';--> statement-breakpoint
ALTER TABLE "column_definitions" ADD COLUMN "geo_role" "geo_role";