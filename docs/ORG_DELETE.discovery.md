# Organization delete from Settings — Discovery

**Issue:** [EnterpriseBT/portal-ai#197](https://github.com/EnterpriseBT/portal-ai/issues/197)

**Why this exists.** There is no self-service way for an org owner to delete their organization. Offboarding (churn, GDPR erasure, closed trials) currently has no path: the only deletion machinery is the dev-only `ResetService` (which deliberately preserves the org and misses six org-scoped surfaces) and the admin-cli's `orgDelete` (which soft-deletes the org row and cascades nothing). For a multi-tenant, billing-facing product this is a table-stakes lifecycle gap. This is the Danger-zone + owner-only DELETE endpoint + full-cascade service that closes it.

## The current shape

### API surface & authorization

| Piece | Location | Note |
|---|---|---|
| Org routes | `apps/api/src/routes/organization.router.ts` | `GET /current`, `PATCH /:id`, `GET /memberships`, `POST /switch`, `GET /usage`. No DELETE. |
| Current-org guard | `apps/api/src/routes/organization.router.ts:94-157` | `PATCH /:id` 404s when path id ≠ `req.application!.metadata.organizationId` — the scoping precedent a DELETE reuses. |
| Current-org resolution | `apps/api/src/services/application.service.ts:24-50` | Live memberships ordered `lastLogin DESC NULLS LAST` (#203); soft-deleted memberships drop out automatically. |
| Request context | `apps/api/src/middleware/metadata.middleware.ts:42-57` | `getApplicationMetadata` populates `{ userId, organizationId }`; zero live memberships → hard 404 `METADATA_ORGANIZATION_NOT_FOUND`. |
| Ownership | `apps/api/src/db/schema/organizations.table.ts:13-15`, `apps/api/src/services/application.service.ts:248` | `ownerUserId` is `notNull` and set at provisioning for every org (webhook signup + both CLI seams share `provisionOrganizationInTx`), but **no route anywhere enforces owner-only today** — this feature introduces the first owner check. |
| Admin-cli inverse | `packages/admin-cli/src/commands/org.ts`, `packages/admin-cli/src/store.ts:166-173` | `orgDelete` soft-deletes only the org row; children untouched. Not a cascade template. |

### Deletion machinery precedents

| Piece | Location | Note |
|---|---|---|
| `ResetService.resetOrganization()` | `apps/api/src/services/reset.service.ts:41-198` | Single transaction, hard-deletes 14 tables child→parent, nulls `defaultStationId` before stations, keeps org + owner membership. |
| Gaps vs a full delete | verified against `reset.service.ts` | Does **not** cover: `usage`, `wide_table_columns`, `api_endpoint_configs`, `organization_toolpacks`, `file_uploads`, `connector_instance_layout_plans`, dynamic `er__*` tables. |
| Wide-table drop | `apps/api/src/services/wide-table-reconciler.service.ts:278-298` | `dropTable()` = raw `DROP TABLE IF EXISTS er__<entityId> CASCADE` + `wide_table_columns` catalog cleanup + statement-cache invalidation. |
| File-upload storage | `apps/api/src/db/schema/file-uploads.table.ts:30`, `apps/api/src/services/s3.service.ts:103-120` | Dual storage: DB row + S3 object (`s3Key`). `S3Service.deleteObject()` swallows NotFound — safe to call blindly. |
| Station delete | `apps/api/src/routes/station.router.ts:725-802` | Transactional cascade precedent (detach results, hard-delete messages, soft-delete portals/station). |
| Connector-instance delete | `apps/api/src/routes/connector-instance.router.ts:1255-1352` | Asserts job locks first (`JobLockService.assertConnectorInstanceUnlocked`, line 1275), then cascades. |

### Schema reality

- **21 tables carry `organizationId`** (verified by grep across `apps/api/src/db/schema/*.table.ts`): organizations, organization-users, usage, stations, portals, portal-results, portal-messages, entity-records, connector-entities, connector-instances, entity-groups, entity-tags, field-mappings, entity-tag-assignments, entity-group-members, column-definitions, wide-table-columns, api-endpoint-configs, organization-toolpacks, file-uploads, jobs.
- **Indirectly scoped:** `station_toolpacks`, `station_instances` (via stations — `station-toolpacks.table.ts:23-24`, `station-instances.table.ts:15-19`), `connector_instance_layout_plans` (via instance — `connector-instance-layout-plans.table.ts:26-29`), plus the dynamic `er__<connectorEntityId>` tables.
- **No FK declares `ON DELETE CASCADE`** — every cascade is app-code, child→parent order, or the transaction fails on referential integrity.
- **Circular reference:** `organizations.defaultStationId` → stations; must be nulled before stations delete (reset does this at `reset.service.ts:127`).
- **Usage ledger** (`apps/api/src/db/schema/usage.table.ts:21-43`): immutable-style rows keyed `(organizationId, periodId, costClass)` — billing-period-aligned audit data (#172).

### Async jobs

- Jobs are BullMQ (`apps/api/src/queues/jobs.queue.ts:5-18`) with an org-scoped `jobs` table (`jobs.table.ts:38`). `TERMINAL_JOB_STATUSES = [completed, failed, cancelled]` (`packages/core/src/models/job.model.ts:32-36`).
- Cancellation exists: `POST /api/jobs/:id/cancel` (`apps/api/src/routes/jobs.router.ts:395-427`) dequeues pending BullMQ jobs and marks the row cancelled — but there is **no worker-side abort**; an `active` job's worker runs to completion regardless.

### Frontend

- Organization tab: `apps/web/src/views/Settings.view.tsx:124-216` — `PageSection`s fed by `sdk.organizations.current()` / `.usage()`. No danger zone.
- SDK: `apps/web/src/api/organizations.api.ts:1-42` has `current/usage/memberships/switch`; DELETE-mutation exemplar is `connector-instances.api.ts:156-160` (`useAuthMutation<void, void>` with `method: "DELETE"`).
- Confirmation dialogs: `DeleteConnectorInstanceDialog.component.tsx:80-150` (impact list + warning) is the strongest existing pattern. **No type-to-confirm exists anywhere** — this feature introduces the pattern.
- Post-delete plumbing: `OrgSwitcher.component.tsx:89-114` already does a full `queryClient.invalidateQueries()` on org switch (all queries are org-scoped); logout is `sdk.auth.logout()` (`apps/web/src/api/auth.api.ts:27-36`). There is no existing "zero orgs left" state.

## The design space

### Decision 1 — Deletion semantics (soft, hard, or tombstone hybrid)

**A. Blanket soft-delete.** Soft-delete the org, memberships, and every child row. Cheap, recoverable, matches the codebase's default. But it is not erasure (GDPR "right to erasure" motivated the ticket), leaves N dynamic `er__*` tables and S3 objects physically present, and "recoverable" is a fiction — nothing can un-delete a 20-table graph consistently.

**B. Full hard purge.** Hard-delete everything including the org row, drop `er__*` tables, delete S3 objects. True erasure. But it destroys the usage ledger (billing/chargeback history, #172) and leaves no record the org ever existed — a dispute liability for a billing-facing product.

**C. Tombstone hybrid.** Hard-purge all org *content* (every table `ResetService` covers plus the six gaps, `er__*` drops, S3 objects), but **soft-delete** the `organizations` row and `organization_users` rows, and **retain `usage` rows untouched**. The soft-deleted org row satisfies the `usage.organizationId` FK, every read filters it out (`base.repository.ts:100-114`), and the billing ledger survives for audit.

| | A soft-everything | B hard-everything | C tombstone hybrid |
|---|---|---|---|
| GDPR erasure of content | No | Yes | Yes |
| Billing/audit record survives | Yes (buried) | No | Yes (org shell + usage + memberships) |
| `er__*` / S3 physically removed | No | Yes | Yes |
| FK gymnastics | None | Must delete usage too | None — shell satisfies FKs |
| Matches issue's "org row removed" | No | Yes | Yes in app semantics (all reads filter it) |

**Confirmed: C** (user, 2026-07-13). Content erasure is real, the billing record of truth survives (retaining billing records under a lawful-basis exemption is standard GDPR practice), and the FK from `usage` resolves for free.

### Decision 2 — Execution shape (synchronous endpoint vs. delete-as-job)

**A. Synchronous `DELETE`.** One request: authorize → single DB transaction (all hard-deletes, `er__*` drops — Postgres DDL is transactional — membership + org soft-deletes) → commit → best-effort S3 cleanup → 200. Simple, atomic, fail-closed.

**B. Delete-as-job.** Soft-delete org + memberships synchronously (access revoked instantly), enqueue an `organization_delete` job for the purge, report progress over SSE. But the deleter loses org access the moment the soft-delete lands — nobody is left to watch the SSE stream — and the job row itself is org-scoped, so the job would have to outlive or delete its own bookkeeping.

| | A synchronous | B job |
|---|---|---|
| Atomicity | One transaction | Two phases; purge can fail after access revoked |
| Request latency | Bounded by org size | Instant |
| Progress UX | None needed (user is leaving) | SSE nobody can watch |
| Job-table self-reference | N/A | Awkward (org-scoped job purging its own org) |

**Lean: A.** Deletion is rare, org data volumes are bounded, and the atomicity of one transaction beats a two-phase purge whose second phase has no observer. If delete latency ever becomes real at scale, a queued purge can be added behind the same endpoint without changing the contract.

### Decision 3 — In-flight jobs (block vs. cancel)

**A. Block.** 409 (`ENTITY_LOCKED_BY_JOB`-style) whenever any non-terminal job exists for the org; the owner waits or cancels manually. Consistent with the existing lock rules, but forces manual cleanup before a legitimate offboarding.

**B. Cancel everything then delete.** Auto-cancel all non-terminal jobs. But `active` jobs have no worker-side abort — a worker mid-sync would keep writing while the cascade deletes under it.

**C. Cancel queued, block on active.** Auto-cancel `pending` / `awaiting_confirmation` / `stalled` jobs (dequeue is safe — `JobsService.cancel`), and 409 only when a job is `active`, listing the running jobs so the owner can wait for the (bounded) worker to finish.

**Confirmed: C** (user, 2026-07-13 — 409 on active jobs). It removes the busywork for the common case without racing a live worker. New API code: `ORGANIZATION_LOCKED_BY_JOB` (or reuse `ENTITY_LOCKED_BY_JOB`).

### Decision 4 — Confirmation strength & enforcement point

**A. Client-only type-to-confirm.** Dialog requires typing the org name; the DELETE request itself carries nothing. Violates the standing rule that safety gates get server enforcement, not prompt/UI enforcement.

**B. Server-verified type-to-confirm.** Dialog collects the typed name **and** the request body carries it (`{ confirmationName }`); the route rejects with 400 (`ORGANIZATION_CONFIRMATION_MISMATCH`) unless it matches the org's name exactly. The UI gate and the server gate are the same fact.

**Lean: B.** It's the same dialog either way, and the server check makes the gate real for every client (including future CLI/API callers).

## Tradeoff comparison

| | D1: tombstone hybrid | D2: synchronous | D3: cancel-queued/block-active | D4: server-verified confirm |
|---|---|---|---|---|
| Spread to spec | Yes — exact per-table hard/soft/retain matrix | Yes — endpoint contract + transaction order | Yes — 409 payload shape | Yes — request body schema |

## Recommendation

1. Add `DELETE /api/organization/:id` to `organization.router.ts`, guarded like `PATCH /:id` (path id must equal the metadata org id), plus a new owner check: 403 (`ORGANIZATION_NOT_OWNER`) when `organization.ownerUserId !== userId`. The contract is safe by construction — `ownerUserId` is `notNull` and set at provisioning for every org (`application.service.ts:248`); confirmed as the right call (user, 2026-07-13).
2. Request body carries `{ confirmationName: string }` validated against the org's current name server-side; mismatch → 400 `ORGANIZATION_CONFIRMATION_MISMATCH`.
3. Before deleting: auto-cancel non-active non-terminal org jobs via the existing cancel path; 409 with the running-job list if any job is `active`.
4. New `OrganizationDeleteService.deleteOrganization(orgId, actorUserId)` in `apps/api/src/services/`, modeled on `ResetService.resetOrganization()`'s child→parent transaction and extended to full coverage: everything reset covers **plus** `api_endpoint_configs`, `organization_toolpacks`, `connector_instance_layout_plans`, `file_uploads`, `wide_table_columns` + `er__*` drops (reusing `WideTableReconcilerService.dropTable`), and `jobs` — with `defaultStationId` nulled before stations.
5. Terminal rows: hard-delete all content; **soft-delete** the `organizations` row and all `organization_users` rows; **retain `usage` untouched** (tombstone hybrid).
6. After commit: best-effort S3 `deleteObject` per collected `file_uploads.s3Key`, failures logged, never rolled back.
7. Frontend: a Danger-zone `PageSection` at the bottom of the Settings Organization tab; `DeleteOrganizationDialog` (pure-UI + container per the component file policy) with type-to-confirm `TextField`, wired to a new `sdk.organizations.delete()` (`useAuthMutation`, `method: "DELETE"`, body `{ confirmationName }`).
8. On success: end the session unconditionally — call `sdk.auth.logout()` (Auth0 logout clears the session cookies/tokens) and land the user on the login page (`returnTo` origin). No switch-to-next-org fallback: deletion always logs out, even for multi-org users, so the post-delete state is a clean re-login (confirmed: user, 2026-07-13).
9. Tests: dialog unit tests per the Dialog & Form Test Checklist (including type-to-confirm gating the submit button), route tests for 403/400/409/200, and a cascade test asserting every org-scoped table (and a created `er__*` table) is empty afterward while `usage` + tombstones survive.

## Open questions

1. **Does the owner's *user* row get touched?** The user row is org-independent and Auth0 is the record of truth; issue marks user deletion out of scope. **Lean: no** — memberships are soft-deleted, the user row and Auth0 account are untouched.
2. **`DELETE /:id` vs `DELETE /current`?** `PATCH /:id` is the guard precedent; `/current` would be a new addressing style for mutations. **Lean: `DELETE /:id`** guarded to the current org, matching PATCH.
3. **Should `jobs` rows be retained like `usage` for audit?** They're operational bookkeeping, not billing truth, and their metadata references purged entities. **Lean: hard-delete** with the content.
4. **Case sensitivity / whitespace of `confirmationName`?** **Lean: exact match after `trim()`** — forgiving on copy-paste whitespace, strict on everything else.
5. **Does the admin-cli's `orgDelete` adopt the full cascade?** It talks to the DB through its own store, not apps/api services, so parity means reimplementation. **Lean: defer** — file a follow-up ticket; the CLI command's soft-delete-only behavior is documented, and dev/staging orgs can be purged via the new endpoint.
6. **Re-auth (password/MFA) before delete?** Auth0 session is already required; step-up auth is real work with SDK implications. **Lean: type-to-confirm only** — consistent with the issue's ask; step-up can layer later without contract change.

## Enterprise-scale considerations

- **Concurrency & correctness** — Lean: the whole cascade is one DB transaction; the route re-reads the org (owner + liveness) inside it, so two concurrent deletes serialize and the second 404s on the soft-deleted row. The active-job 409 is checked inside the same transaction scope to avoid check-then-act races with job enqueue.
- **Accuracy & auditability** — Lean: the tombstone hybrid *is* the audit story — soft-deleted org shell + memberships (who belonged, who deleted, when via `deleted`/`deletedBy`) + untouched `usage` ledger for billing/chargeback. Deletion is also logged at route + service layers with actor id.
- **Failure modes** — Lean: fail-closed for data (any error rolls back the transaction; org remains intact and functional). S3 cleanup is post-commit best-effort — an orphaned unreachable object is acceptable; a half-deleted org is not. Each skipped S3 key is logged.
- **Scale & unbounded growth** — Lean: cascade cost is bounded by one org's data; `er__*` drops are one DDL per connector entity. Synchronous is a conscious choice (deletes are rare, no production data yet per project status); if a pathological org makes the request time out, the queued-purge escalation slots behind the same endpoint.
- **Multi-tenancy** — Lean: every delete statement is keyed by `organizationId` (or an id set fetched within the org scope in the same transaction); `er__*` names derive from that same in-transaction entity set. No cross-tenant reach is possible by construction.
- **Contract stability** — Lean: `{ confirmationName }` body + typed error codes (403/400/409) leave room for future step-up auth, grace-period restore (the tombstone already exists), and tier-gated retention without endpoint changes.
- **Data lifecycle** — Lean: `usage` retention aligns with billing periods (#172) and survives indefinitely for now; a retention policy for tombstoned orgs is future policy work, not this ticket.

## What this doesn't decide

- **Individual user-account deletion** — explicitly out of scope in the issue; memberships are the only user-adjacent rows touched.
- **Admin-cli cascade parity** — deferred to a follow-up ticket (open question 5); the CLI's store-level soft-delete stays as-is for now.
- **Grace-period restore / "undo"** — the tombstone makes a future restore-window feature *possible* for the shell, but content is purged; no restore is promised or built here.
- **Step-up re-authentication** — deferred (open question 6); the server-verified type-to-confirm is the gate.
- **Worker-side job abort** — blocking on `active` jobs sidesteps it; building cooperative cancellation into workers is its own ticket.

## Next step

Write `docs/ORG_DELETE.spec.md` (endpoint contract: request/response/error codes, the per-table hard/soft/retain matrix, dialog behavior, and the TDD test plan) and `docs/ORG_DELETE.plan.md`. Expected slicing: (1) `OrganizationDeleteService` cascade + tests against a fully-populated org fixture, (2) the DELETE route with owner/confirmation/job-lock gates + tests, (3) SDK method + Danger-zone UI + `DeleteOrganizationDialog` + tests, (4) post-delete navigation/logout handling + smoke doc.
