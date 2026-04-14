ALTER TABLE "portals" ADD COLUMN "last_opened" bigint;--> statement-breakpoint
UPDATE "portals" SET "last_opened" = "created" WHERE "last_opened" IS NULL;
