# Organization delete from Settings — Spec

**Issue:** [EnterpriseBT/portal-ai#197](https://github.com/EnterpriseBT/portal-ai/issues/197) · **Discovery:** `docs/ORG_DELETE.discovery.md`

Pins the contract for owner-initiated organization deletion: a `DELETE /api/organization/:id` endpoint (owner-only, server-verified type-to-confirm, job-lock-aware) backed by a full-cascade `OrganizationDeleteService` (hard-purge content, tombstone the org + memberships, retain `usage`), and the Settings Danger-zone UI that drives it and logs the user out on success.

## Key decisions (ratified from discovery, all user-confirmed)

1. **D1 — tombstone hybrid.** All org *content* is hard-deleted (including `er__*` table drops and S3 objects); the `organizations` row and all `organization_users` rows are **soft-deleted**; `usage` rows are **retained untouched** (billing audit; the soft-deleted org row satisfies their FK).
2. **D2 — synchronous endpoint.** One request, one DB transaction (Postgres DDL is transactional, so the `er__*` drops ride inside it), best-effort S3 cleanup after commit.
3. **D3 — cancel queued, 409 on active.** Non-terminal non-`active` jobs are auto-cancelled via the existing `JobsService.cancel`; any `active` job blocks with 409 + `runningJobs` (reusing `ENTITY_LOCKED_BY_JOB` so the frontend's existing renderer works).
4. **D4 — server-verified confirmation.** The request body carries `{ confirmationName }`; the route rejects unless it equals the org's name (`trim()`-ed exact match). The dialog's type-to-confirm and the server gate are the same fact.
5. **Owner-only, server-side.** 403 unless `organization.ownerUserId === userId` — the codebase's **first** owner check (`ownerUserId` is `notNull` and set for every org at provisioning, `application.service.ts:248`).
6. **Post-delete = logout.** On success the web app unconditionally calls the Auth0 logout (clears session cookies/tokens) and lands on the login page — no switch-to-next-org fallback.

## Scope

### In scope

1. `OrganizationDeleteRequest`/`Response` contracts (`packages/core`).
2. Three `ApiCode` additions + `DELETE /api/organization/:id` route with `@openapi` block.
3. `OrganizationDeleteService` — job sweep + full-cascade transaction + post-commit S3 cleanup.
4. `JobsRepository.findRunningForOrganization` + `JobLockService.findRunningForOrganization`.
5. Web: `sdk.organizations.delete()`, Danger-zone `PageSection` in Settings → Organization, `DeleteOrganizationDialog` (type-to-confirm), logout-on-success wiring.
6. FAQ entry for org deletion (docs-sync check).

### Out of scope

- Individual user-account deletion (user rows + Auth0 accounts untouched; memberships only soft-deleted).
- Admin-cli cascade parity (`orgDelete` stays store-level soft-delete; follow-up ticket).
- Grace-period restore, step-up re-auth, worker-side job abort (discovery → "What this doesn't decide").
- Tombstone retention policy.

## Surface

### Contracts — `packages/core/src/contracts/organization.contract.ts` (edit)

```ts
/** Body for DELETE /api/organization/:id — the server-verified type-to-confirm gate. */
export const OrganizationDeleteRequestSchema = z.object({
  confirmationName: z.string().min(1),
});
export type OrganizationDeleteRequest = z.infer<typeof OrganizationDeleteRequestSchema>;

export const OrganizationDeleteResponseSchema = z.object({
  id: z.string(), // the deleted (tombstoned) organization id
});
export type OrganizationDeleteResponse = z.infer<typeof OrganizationDeleteResponseSchema>;
```

Re-export both from `packages/core/src/contracts/index.ts`.

### Error codes — `apps/api/src/constants/api-codes.constants.ts` (edit, Organization section)

```ts
/** DELETE authz: the caller is a member but not the org's owner. 403. */
ORGANIZATION_NOT_OWNER = "ORGANIZATION_NOT_OWNER",
/** DELETE confirmation: `confirmationName` doesn't match the org's name. 400. */
ORGANIZATION_CONFIRMATION_MISMATCH = "ORGANIZATION_CONFIRMATION_MISMATCH",
/** DELETE cascade failed server-side (transaction rolled back). 500. */
ORGANIZATION_DELETE_FAILED = "ORGANIZATION_DELETE_FAILED",
```

The 409 path **reuses** `ENTITY_LOCKED_BY_JOB` (`api-codes.constants.ts:69`) with the same `details.runningJobs: RunningJobSummary[]` shape — one frontend renderer for all lock errors.

### Route — `DELETE /api/organization/:id` (`apps/api/src/routes/organization.router.ts`, edit)

Mounted with `getApplicationMetadata` (like `PATCH /:id`, `organization.router.ts:94-157`). Handler order:

1. **Current-org guard:** `id !== req.application!.metadata.organizationId` → 404 `ORGANIZATION_NOT_FOUND` (identical to PATCH).
2. **Body:** `OrganizationDeleteRequestSchema.safeParse(req.body)` → 400 `ORGANIZATION_INVALID_PAYLOAD` on shape failure.
3. **Fetch org** (`DbService.repository.organizations.findById(id)`) → 404 `ORGANIZATION_NOT_FOUND` if absent (already-deleted org falls out here — the soft-delete filter makes a repeat DELETE a 404, giving idempotent-safe semantics).
4. **Owner check:** `org.ownerUserId !== userId` → 403 `ORGANIZATION_NOT_OWNER`.
5. **Confirmation:** `body.confirmationName.trim() !== org.name.trim()` → 400 `ORGANIZATION_CONFIRMATION_MISMATCH`.
6. `await OrganizationDeleteService.deleteOrganization(id, userId)` — may throw 409 `ENTITY_LOCKED_BY_JOB`.
7. `HttpService.success<OrganizationDeleteResponse>(res, { id })`.

Errors follow the router's existing pattern (`next(ApiError)`, 500 fallback → `ORGANIZATION_DELETE_FAILED`). `@openapi` block: `delete` on `/api/organization/{id}`, `bearerAuth`, path param `id`, requestBody `$ref: '#/components/schemas/OrganizationDeleteRequest'`, responses 200 (payload `$ref: OrganizationDeleteResponse`), 400/403/404/409/500 → `ApiErrorResponse`. Register `OrganizationDeleteRequest` + `OrganizationDeleteResponse` in `apps/api/src/config/swagger.config.ts` via `z.toJSONSchema` from the contract schemas.

### Job sweep — `apps/api/src/db/repositories/jobs.repository.ts` + `apps/api/src/services/job-lock.service.ts` (edit)

```ts
// jobs.repository.ts — sibling of findRunningForConnectorInstance (:78)
async findRunningForOrganization(organizationId: string): Promise<JobSelect[]>
// WHERE organization_id = $1 AND status IN NON_TERMINAL_JOB_STATUSES AND deleted IS NULL

// job-lock.service.ts — maps rows through the existing toSummary (:40)
static async findRunningForOrganization(organizationId: string): Promise<RunningJobSummary[]>
```

### Cascade service — `apps/api/src/services/organization-delete.service.ts` (new)

```ts
export class OrganizationDeleteService {
  /** Full org deletion per D1–D3. Throws ApiError(409, ENTITY_LOCKED_BY_JOB) if an
   *  active job holds the org. Caller (route) has already authorized + confirmed. */
  static async deleteOrganization(organizationId: string, actorUserId: string): Promise<void>
}
```

**Phase 1 — job sweep (pre-transaction).** `findRunningForOrganization`; for each non-terminal job with `status !== "active"`, `JobsService.cancel(jobId)` (`jobs.service.ts:116` — dequeues from BullMQ, transitions to `cancelled`; a `JOB_ALREADY_TERMINAL` race is caught and ignored). Re-fetch; if any job is now/still `active` → throw 409 `ENTITY_LOCKED_BY_JOB` with `{ runningJobs }`. Cancel-then-recheck closes the pending→active window: a pending job either got dequeued (can't start) or slipped to `active` first and surfaces in the recheck.

**Phase 2 — one `DbService.transaction`,** modeled on `ResetService.resetOrganization` (`reset.service.ts:53-192`) and extended to full coverage. Order (child → parent; all deletes keyed by `organizationId` or an id-set selected within the same transaction):

1. Collect live `connectorEntityIds` (org-scoped; wide-table lifecycle is tightly coupled to its entity — a wide table never outlives its entity row, so the live entity set is the complete drop list) and `fileUploads.s3Key` values (including soft-deleted rows; returned to phase 3).
2. Hard-delete, same statements as reset: `entityGroupMembers`, `entityTagAssignments`, `entityRecords`, `fieldMappings`, `portalResults`, `portalMessages`, `portals`.
3. `stationToolpacks` + `stationInstances` via the org-station-ids subquery (reset `:104-123`), null `organizations.defaultStationId` (`:125-129`), then `stations`.
4. **Gap coverage (new vs reset):** `connectorInstanceLayoutPlans` via org-connector-instance-ids subquery (before instances); `apiEndpointConfigs` by `organizationId`.
5. **Wide tables:** per collected entity id, `wideTableReconcilerService.dropTable(entityId, tx)` (`wide-table-reconciler.service.ts:278-298` — `DROP TABLE IF EXISTS er__<id> CASCADE`, hard-deletes that entity's `wide_table_columns` rows, invalidates the statement cache); then a safety-net hard-delete of any remaining `wideTableColumns` rows by `organizationId`.
6. `connectorEntities`, `connectorInstances`, `entityGroups`, `entityTags`, `columnDefinitions`.
7. **Gap coverage:** `organizationToolpacks`, `fileUploads` (rows) by `organizationId`.
8. `jobs` by `organizationId` (hard-delete — operational bookkeeping, discovery open Q3).
9. **Tombstones:** soft-delete **all** `organizationUsers` rows (`UPDATE … SET deleted = now, deleted_by = actorUserId WHERE organization_id = …` — owner included, unlike reset `:180-191`), then soft-delete the `organizations` row the same way. **`usage` rows are not touched.**

**Phase 3 — post-commit S3 cleanup (best-effort, fail-open).** For each collected `s3Key`: `S3Service.deleteObject(key)` (`s3.service.ts` — swallows NotFound); any other error is logged (`warn`, with `organizationId` + key) and **not** rethrown — the API response is already determined by the committed transaction.

Logging: route + service log at `info` with `{ organizationId, orgName, actorUserId }` and per-table delete counts (reset's pattern).

### Web SDK — `apps/web/src/api/organizations.api.ts` (edit)

```ts
/** Owner-only org deletion. Variables ARE the request body ({ confirmationName }).
 *  Consumers log out on success — no cache invalidation needed. */
delete: (id: string) =>
  useAuthMutation<OrganizationDeleteResponse, OrganizationDeleteRequest>({
    url: `/api/organization/${id}`,
    method: "DELETE",
  }),
```

(Mirrors the `connector-instances.api.ts:156-160` DELETE exemplar; no new query key — nothing is refetched after logout.)

### Danger zone — `apps/web/src/views/Settings.view.tsx` (edit)

After the "Subscription & Usage" `PageSection` (`Settings.view.tsx:179-211`), add a `PageSection title="Danger zone" variant="outlined"` containing a short warning `Typography` and a `Button color="error" variant="outlined"` ("Delete organization"). The view (container) owns: `deleteDialogOpen` state, `const deleteMutation = sdk.organizations.delete(organization.id)`, and

```ts
const handleDeleteConfirm = (confirmationName: string) =>
  deleteMutation.mutate({ confirmationName }, { onSuccess: () => logout() });
```

where `logout` comes from the existing Auth0 logout wrapper (`apps/web/src/api/auth.api.ts:27-36`, invoked as in `HeaderMenu.component.tsx:90-93`) — clears the session and returns to the login page. The dialog receives `serverError={toServerError(deleteMutation.error)}` and `isPending={deleteMutation.isPending}`.

### Dialog — `apps/web/src/components/DeleteOrganizationDialog.component.tsx` (new)

Pure UI component (single-component file per the Component File Policy — no SDK, no context):

```ts
export interface DeleteOrganizationDialogProps {
  open: boolean;
  onClose: () => void;
  organizationName: string;
  onConfirm: (confirmationName: string) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}
```

Shape mirrors `DeletePortalDialog.component.tsx` (Modal + `slotProps.paper.component="form"` + `onSubmit` preventDefault → confirm; Cancel/Delete buttons `type="button"`, disabled on `isPending`; `<FormAlert serverError>`), plus the type-to-confirm mechanics:

- Warning copy: permanent, destroys **all** organization data (stations, portals, connectors, records, uploads), cannot be undone.
- A `TextField` labeled `Type "<organizationName>" to confirm`, auto-focused via `useDialogAutoFocus(open)`, value in local state, cleared whenever `open` flips.
- Local gate `matches = value.trim() === organizationName.trim()`; the Delete button is `disabled={!matches || isPending}` and form-submit is a no-op while `!matches`. On confirm: `onConfirm(value.trim())` — the server re-verifies (D4).
- `data-testid="confirm-delete-organization"` on the Delete button; the field carries `slotProps={{ htmlInput: { "aria-invalid": touched && !matches } }}` + helperText prompting the exact name after blur.

### FAQ — `apps/web/src/utils/faq.util.ts` (edit)

One new Q&A: "How do I delete my organization?" → Settings → Organization → Danger zone; owner-only; permanent; type the org name to confirm; you'll be signed out afterward. (Docs-sync inventory: no glossary/getting-started/tool-surface impact.)

## Migration / Seed

**None.** No schema change — every column this feature touches (`deleted`/`deletedBy` on `organizations`/`organization_users`, all content tables) already exists. State it here explicitly so the plan carves no migration slice.

## TDD test plan

Run via npm scripts only: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — core contracts (`packages/core/src/__tests__/contracts/organization.contract.test.ts` or existing sibling)

1. `OrganizationDeleteRequestSchema` accepts `{ confirmationName: "Acme" }`; rejects `{}` and empty string.
2. `OrganizationDeleteResponseSchema` round-trips `{ id }`.

### Layer 2 — cascade service (`apps/api/src/__tests__/__integration__/services/organization-delete.service.integration.test.ts`, new)

Fixture: a fully-populated org (station + toolpack link + instance link, portal + messages + pinned result, connector instance + entity + field mappings + records + layout plan, an `er__*` table via `wideTableReconcilerService`, column definitions, groups/tags(+assignments/members), org toolpack, api-endpoint config, file-upload row, usage rows, a second member, a `pending` and a `completed` job) **plus a control org** with the same shapes.

3. All 19 content tables have zero rows for the org after delete (loop-assert per table).
4. The `er__<entityId>` table no longer exists (`pg_tables` probe) and its `wide_table_columns` rows are gone.
5. `usage` rows for the org survive untouched.
6. `organizations` row is soft-deleted (`deleted` set, `deletedBy = actor`); `findById` no longer returns it.
7. All `organization_users` rows (owner included) are soft-deleted.
8. The control org's data is fully intact (multi-tenant isolation).
9. `pending` job was cancelled (status `cancelled` before its row is hard-deleted is observable via the cancel spy) and the delete proceeded; with a mocked `active` job the service throws 409 `ENTITY_LOCKED_BY_JOB` carrying `runningJobs`, and **nothing** was deleted (transaction never started).
10. `defaultStationId` is nulled before station deletion (fixture org uses its default station — the delete succeeds, no FK error).
11. S3 cleanup: `S3Service.deleteObject` called once per collected `s3Key` after commit; a throwing `deleteObject` does **not** fail the delete (spy + rejected mock).

### Layer 3 — route integration (`apps/api/src/__tests__/__integration__/routes/organization.router.integration.test.ts`, extend)

12. 401 without a token.
13. 404 when `:id` is not the caller's current org.
14. 403 `ORGANIZATION_NOT_OWNER` for a non-owner member (correct body, correct org).
15. 400 `ORGANIZATION_INVALID_PAYLOAD` for a missing body; 400 `ORGANIZATION_CONFIRMATION_MISMATCH` for a wrong name (case-sensitive; `" Acme "` with spaces passes via trim).
16. 200 happy path returns `{ id }`; subsequent `GET /api/organization/current` for that user → 404; repeat DELETE → 404.
17. 409 with `details.runningJobs` when an `active` job exists.

### Layer 4 — web (`apps/web/src/__tests__/DeleteOrganizationDialog.test.tsx` new; `Settings` test extend)

18. Renders title/warning when open; nothing when closed.
19. Delete button disabled initially; still disabled on a non-matching name; enabled on exact match (and on match with surrounding whitespace).
20. `onConfirm` called with the trimmed name on button click **and** on Enter/form submit; **not** called while non-matching.
21. Input clears when the dialog reopens.
22. Pending state disables both buttons and shows progress label.
23. `FormAlert` renders with `serverError`, absent when null.
24. `aria-invalid` on the field after blur with a non-match; the text field has the required label.
25. Settings Organization tab renders the Danger zone section and opens the dialog (mocked `sdk`).
26. Successful mutation triggers the logout callback (mocked `sdk.organizations.delete` + `jest.unstable_mockModule`, per `cache-invalidation.test.tsx` style).

**Totals ≈ 26 cases** (2 core, 9 service, 6 route, 9 web). No migration test — no migration.

## Acceptance criteria

- [ ] An org owner sees a Danger zone in Settings → Organization and can delete the org after typing its exact name; non-owners get a 403 even with a correct name (server-enforced, not just hidden).
- [ ] A wrong or missing `confirmationName` is rejected server-side (400) regardless of client behavior.
- [ ] After deletion: every org-scoped content table has zero rows for the org, all `er__*` tables for its entities are dropped, its S3 upload objects are removed (best-effort), the org + membership rows are soft-deleted, and `usage` rows survive.
- [ ] Another org's data is untouched by a delete (isolation proven by test).
- [ ] Queued jobs are auto-cancelled; an `active` job blocks with 409 + `runningJobs`, and no partial deletion occurs.
- [ ] On success the user is logged out (Auth0 session cleared) and lands on the login page.
- [ ] All new tests pass; `npm run lint && npm run type-check` clean; FAQ updated.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| A pending job goes `active` between sweep and transaction. | Cancel-then-recheck (phase 1): cancelled jobs are dequeued and can't start; anything that raced to `active` surfaces in the recheck → 409, transaction never opens. **Fail-closed** — deletion is the thing that must not half-run. |
| Worker mid-run while its org vanishes (if the 409 gate were bypassed). | The gate is the defense; worker null-guard hardening is explicitly deferred (discovery). The 409 path is tested with nothing-deleted asserted. |
| Long transaction / lock pressure on a huge org (DDL drops inside the tx). | Accepted consciously (D2): deletes are rare, org volumes bounded, no production data yet. Escalation path (queued purge behind the same endpoint) documented in discovery. |
| Orphaned S3 objects if post-commit cleanup fails. | Best-effort by design (fail-open for storage only): objects are unreachable (rows gone), every skip logged with key + org for manual sweep. |
| A future org-scoped table is missed by the cascade. | Service test 3 loop-asserts over the schema-derived table list; adding a table with `organizationId` without extending the cascade fails the "zero rows per table" loop when the fixture grows. Called out in the plan as a fixture-maintenance note. |
| `usage` FK breaks if someone "fixes" the tombstone into a hard delete. | Test 5 + 6 pin the tombstone semantics; the service JSDoc states the FK dependency. |

**Rollback:** pure code revert (`git revert` the slices) — no migration, no data shape change. Orgs deleted before the revert stay deleted (that's the feature's contract, not a rollback hazard).

## Files touched

**`packages/core`** — edit: `contracts/organization.contract.ts` (+2 schemas), `contracts/index.ts`; new/extended contract test.

**`apps/api`** — new: `services/organization-delete.service.ts`, `__tests__/__integration__/services/organization-delete.service.integration.test.ts`; edit: `routes/organization.router.ts` (+DELETE), `constants/api-codes.constants.ts` (+3), `db/repositories/jobs.repository.ts` (+finder), `services/job-lock.service.ts` (+org lookup), `config/swagger.config.ts` (+2 components), route integration test.

**`apps/web`** — new: `components/DeleteOrganizationDialog.component.tsx`, `__tests__/DeleteOrganizationDialog.test.tsx`; edit: `api/organizations.api.ts` (+delete), `views/Settings.view.tsx` (Danger zone + wiring), `utils/faq.util.ts` (+1 Q&A), Settings/cache tests.

No migration. No new dependency. No env-var change.

## Next step

`docs/ORG_DELETE.plan.md` — expected slices, each a testable commit on this branch: (1) contracts + error codes + `JobsRepository`/`JobLockService` org finder; (2) `OrganizationDeleteService` cascade + integration tests (the bulk of the work); (3) `DELETE` route + guards + swagger + route tests; (4) `DeleteOrganizationDialog` + SDK method + dialog tests; (5) Settings Danger zone + logout wiring + FAQ + smoke doc.
