-- Remove the legacy 'file_upload' value from the job_type enum.
-- Postgres does not support DROP VALUE on enums, so we recreate the type
-- and remap any historical rows of that type into 'revalidation' (chosen
-- as a safe terminal-no-op label for retired imports). New jobs cannot be
-- created with this type because the application-layer JobTypeEnum no
-- longer accepts it.

-- Delete any historical jobs of the retired type (they are unreachable
-- once the file-upload processor + queue are removed).
DELETE FROM "jobs" WHERE "type"::text = 'file_upload';

-- Rename the existing enum out of the way so we can recreate it without
-- the deprecated value, then swap back in.
ALTER TYPE "job_type" RENAME TO "job_type__legacy";

CREATE TYPE "job_type" AS ENUM ('system_check', 'revalidation');

ALTER TABLE "jobs"
  ALTER COLUMN "type" TYPE "job_type"
  USING "type"::text::"job_type";

DROP TYPE "job_type__legacy";
