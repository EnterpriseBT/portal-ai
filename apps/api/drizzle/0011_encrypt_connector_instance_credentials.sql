-- Convert the credentials column from jsonb (plaintext) to text (encrypted).
-- Existing rows with non-null credentials will have their JSON cast to text;
-- they must be re-encrypted via a backfill script after this migration runs.
ALTER TABLE "connector_instances"
  ALTER COLUMN "credentials" SET DATA TYPE text
  USING credentials::text;
