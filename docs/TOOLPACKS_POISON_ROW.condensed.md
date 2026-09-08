# Toolpacks list resilient to an undecryptable (poison) org-toolpack row — #531

**Why.** A single `organization_toolpacks` row whose encrypted `signing_secret` can't be decrypted under the current env's `ENCRYPTION_KEY` (written under a different key) takes down the **entire** `GET /api/toolpacks` list for the org with a `500` — `decryptRows` throws the GCM auth-tag failure and the whole request fails. The same throw blocks the demo seeder's idempotent re-registration, because its find-to-update step decrypts every row too. One poison row poisons the whole surface. Creation of new poison rows is already fixed by #530 (env `ENCRYPTION_KEY` injection in `runApiScript`); this is defense-in-depth for **reads**.

## Current shape

`apps/api/src/db/repositories/organization-toolpacks.repository.ts` decrypts `authHeaders` + `signingSecret` on every read via `decryptRow`, which **throws** on a bad blob. `findByOrganizationId` maps `decryptRows` over all live rows and is the method behind three list-oriented callers — the toolpacks list (`toolpacks.router.ts:156`), the two name-uniqueness checks (create `:331`, rename `:476`) — and the demo seeder's idempotency lookup (`demo-seed.service.ts:430`). **None of these four callers reads the decrypted signing secret** — they use `name`/`id`/`tools`/`authHeaders`-presence only. The decrypt is an incidental side effect that only ever hurts here.

The genuine secret consumers are the single-/multi-row fetches: `findByIdScoped` (outbound webhook signing) and `findManyByIds` (session-build `WebhookTool` construction). Those must stay strict.

## Decision — resilient list path, strict single-row paths

Make **only** `findByOrganizationId` lenient. Decrypt per-row in a try/catch; on failure, log a warning and return a **degraded** row — `signingSecret: ""`, `authHeaders: null`, and a new `secretDecryptable: false` marker — instead of throwing. On success the row carries `secretDecryptable: true`. Return type widens to `OrganizationToolpackWithSecretStatus[]` (`OrganizationToolpackSelect` + the marker), an internal repository type — **no API contract change** (the list record's `signingSecretStatus.has` stays `true`; the row genuinely has a secret, it just can't be read under this key).

This fixes both symptoms at once:
- **List** no longer 500s — the poison row appears, minus its secret.
- **Seeder repair** works — the idempotency lookup now returns the poison row (name isn't encrypted), so `update` overwrites it with a fresh, correctly-encrypted secret. No manual soft-delete first.

`findById`/`findMany`/`findManyByIds`/`findByIdScoped` are untouched and stay strict — a caller that genuinely needs the secret still fails loudly rather than silently signing with an empty key.

## Plan — 1 slice

1. `organization-toolpacks.repository.ts`: add `OrganizationToolpackWithSecretStatus` type + a `tryDecryptRow` helper (wraps `decryptRow`, degrades on throw with a logged warning); switch `findByOrganizationId` to it. Integration tests: (a) a poison row no longer throws `findByOrganizationId` and returns degraded (`secretDecryptable: false`, empty secret) alongside a healthy row still decrypted; (b) `findByIdScoped` still throws on the poison row.

## Smoke (manual, against your dev stack)

- Seed the demo org, then hand-corrupt one `organization_toolpacks.signing_secret` blob (mutate its base64 `data`) via `portalops db psql --env local`. `GET /api/toolpacks` → **200** with the toolpack still listed (not a 500). Re-run the demo seeder → it **repairs** the row (no "already exists"/decrypt abort), and a subsequent list shows the row healthy again.

## Out of scope

- Surfacing `secretDecryptable: false` in the API/UI as a "needs repair" badge (contract change; not needed to un-break the list).
- A bulk key-rotation / re-encrypt tool. #530 already stops new poison rows; the seeder repairs the known one.
