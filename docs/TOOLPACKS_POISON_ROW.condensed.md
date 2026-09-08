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

Walked live against the local stack (API :3001, real `ENCRYPTION_KEY`, real demo org `62977305…`, toolpack `demo_supply_tools`). Poison = a valid envelope with the GCM `authTag` zeroed so decrypt fails with the production error. Boxes unchecked — yours to confirm against the evidence below.

- [ ] **Baseline** — `GET /api/toolpacks?kind=custom` → **200**, `demo_supply_tools` listed.
- [ ] **List survives a poison row** — with `signing_secret.authTag` zeroed, `GET /api/toolpacks?kind=custom` → **200**, row still listed (`signingSecretStatus.has: true`). *This is the fix — pre-fix this 500s.*
- [ ] **Strict single-row stays strict** — same poison row, `GET /api/toolpacks/:id` (uses `findByIdScoped`) → **500**. Confirms the poison is genuinely undecryptable (the exact pre-fix list failure) and that secret-needing paths still fail loudly.
- [ ] **Seeder-mechanic repair** — the seeder's idempotency step (`findByOrganizationId(...).find(byName)` → `update`, demo-seed.service.ts:429-439) run against the real poisoned row: `findByOrganizationId` returns it degraded (`secretDecryptable: false`, empty secret) **without throwing**, logs the `#531` warning with the row id + GCM error, and the follow-up `update` restores a decryptable secret (strict `findByIdScoped` then reads it). *Exercised via the repository directly; a full `demo seed` needs `DEMO_TOOLPACK_URL` + a reachable webhook, orthogonal to this bug.*
- [ ] **Restored** — original good blob written back; both endpoints → **200**. Demo org left exactly as found.

Evidence: list `HTTP 200` on the poisoned row, strict `HTTP 500` on the same row, repair probe → `{"step":"findByOrganizationId","threw":false,"found":true,"secretDecryptable":false,"signingSecretIsEmpty":true}` then `{"step":"afterRepair","strictFindThrew":false,"signingSecret":"whsec_smoke_531_repair"}`, plus the repository warning log firing with `error: "Unsupported state or unable to authenticate data"`.

## Out of scope

- Surfacing `secretDecryptable: false` in the API/UI as a "needs repair" badge (contract change; not needed to un-break the list).
- A bulk key-rotation / re-encrypt tool. #530 already stops new poison rows; the seeder repairs the known one.
