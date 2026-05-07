-- Add `signing_secret` to `organization_toolpacks` — phase 6.
--
-- Every outbound webhook call (schema, metadata, runtime) is now
-- HMAC-signed with a per-toolpack secret so the receiving server can
-- verify the request originated from us. Stripe-style: the secret is
-- generated server-side, returned to the admin once on registration,
-- encrypted at rest (same crypto.util as phase 5's auth_headers),
-- and rotated via POST /api/toolpacks/:id/rotate-signing-secret to
-- view it again.
--
-- Existing rows get a sentinel value here. The companion Node script
-- `apps/api/src/scripts/migrate-signing-secrets.ts` reads each row
-- with the sentinel, generates a fresh secret, encrypts it via the
-- same `encryptCredentials()` used by the repository, and writes
-- back. The script is idempotent and runs once after `db:migrate`
-- as part of the deploy sequence. Until it runs, the repository's
-- decrypt path detects the sentinel and throws
-- TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED rather than handing the
-- sentinel string to a caller as if it were a real secret.

ALTER TABLE "organization_toolpacks"
  ADD COLUMN "signing_secret" text;

UPDATE "organization_toolpacks"
  SET "signing_secret" = '__pending_phase6_rotation__'
  WHERE "signing_secret" IS NULL;

ALTER TABLE "organization_toolpacks"
  ALTER COLUMN "signing_secret" SET NOT NULL;
