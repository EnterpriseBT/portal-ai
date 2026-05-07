-- Encrypt `organization_toolpacks.auth_headers` at rest.
--
-- Phase 1–4 stored auth headers as plain jsonb — visible in dumps,
-- replicas, and to anyone with database read access. Phase 5 changes
-- the column to `text` to hold an opaque AES-256-GCM ciphertext blob
-- emitted by `encryptCredentials()` (apps/api/src/utils/crypto.util.ts);
-- the repository decrypts on every read, so callers continue to see
-- a plaintext `Record<string, string> | null` map.
--
-- Pre-existing rows are nulled in place (P-5.1 in the phase-5 spec).
-- The feature is too young to warrant an in-place backfill encryption;
-- org admins re-enter their auth headers via EditToolpackDialog after
-- deploy. The endpoints/tools/metadata cached on each row are
-- preserved, so the toolpack's identity and tool list survive — only
-- the credentials drop.
--
-- The `USING NULL` clause on the type cast is belt-and-braces against
-- a concurrent insert mid-migration: even if a row escapes the prior
-- UPDATE, the cast forces it to NULL rather than calling `::text` on
-- the jsonb (which would publish the plaintext map to the new column).

UPDATE "organization_toolpacks" SET "auth_headers" = NULL;

ALTER TABLE "organization_toolpacks"
  ALTER COLUMN "auth_headers" TYPE text USING NULL;
