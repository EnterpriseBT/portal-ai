ALTER TABLE "organization_users" ADD COLUMN "last_login" bigint;
UPDATE "organization_users" SET "last_login" = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint WHERE "last_login" IS NULL;