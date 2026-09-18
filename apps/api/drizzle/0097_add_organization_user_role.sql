ALTER TABLE "organization_users" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
-- #576 backfill: the ADD COLUMN default set every existing membership to
-- 'member'; promote each org's owner membership to 'owner'. Keyed on
-- organizations.owner_user_id so no one is locked out. Live rows only.
UPDATE "organization_users" AS ou
SET "role" = 'owner'
FROM "organizations" AS o
WHERE ou."organization_id" = o."id"
  AND ou."user_id" = o."owner_user_id"
  AND ou."deleted" IS NULL;--> statement-breakpoint
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_role_check" CHECK ("organization_users"."role" IN ('owner', 'admin', 'member'));