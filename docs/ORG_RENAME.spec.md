# Rename an organization from Settings — Spec

Pins the contract for #907: the `write org` permission and its `org.write` caller capability, a strict body schema for `PATCH /api/organization/:id` with per-field checks, the `org.update` audit entry, the best-effort Stripe name sync, and the Settings rename dialog. Discovery: `docs/ORG_RENAME.discovery.md`. Issue: [#907](https://github.com/EnterpriseBT/portal-ai/issues/907).

## Key decisions (flag for review)

1. **Rename checks `resource.write {type:"org"}`.** Owner and Admin hold it through `* *`, with no seed change. `org` gains the `write` verb so a policy can name it.
2. **The web gates on a caller action `org.write`** (`ACTION_MAP` → `{write, org}`), shaped like `org.delete`, not a derived capability.
3. **Field-presence gating.** `name` present → `org.write` is checked. `defaultStationId` present → today's class `resource.write {type:"station"}` check and station lookup run. A field that's absent is neither checked nor written. `{}` is a 400 (OQ1).
4. **The name write locks the row.** `OrganizationUpdateService.apply` runs in one transaction: `SELECT … FOR UPDATE`, then `UPDATE … RETURNING`. Each concurrent rename therefore records the `from` it actually replaced. Last write wins.
5. **Audit after commit, only when the name changes.** `org.update` with `metadata: { field: "name", from, to }`. It's fail-open, like every audit write. Default-station changes aren't audited (#935).
6. **Stripe after commit, best effort.** It runs only when the name changed, the org has `stripeCustomerId`, and `StripeService.isConfigured()`. A failure logs a warning and the rename still answers 200.
7. **The CLI is unchanged** (#936). There is no agent tool.

## Scope

### In scope
- Core: the verb, the capability, the request schema, the audit action, the FAQ entry.
- API: the PATCH rewrite, `OrganizationUpdateService`, `StripeService.updateCustomerName`, the refusal phrase, OpenAPI, the route map.
- Web: `sdk.organizations.update`, `RenameOrganizationDialog`, the Settings wiring, the Activity summary, and the `stations.setDefault` type fix.

### Out of scope
- Auditing default-station changes (#935).
- CLI rename audit and Stripe sync (#936).
- Unique names, and editing timezone or other org fields.
- An agent tool for renaming.

## Surface

### Core — permissions (`packages/core/src/models/permission.model.ts`)
- `RESOURCE_CAPABILITIES.org` (:360) → `{ verbs: ["write", "delete"], instanceScope: false, ownership: false }`. Update the comment above it to name `org.write`.
- `CALLER_CAPABILITY_ACTIONS` (:160) gains `"org.write"` after `"org.delete"`, with a doc comment: "#907: rename the organization; class `write org`". `CapabilityMapSchema` is exhaustive, so every `CapabilityMap` fixture gains the key.

### Core — contract (`packages/core/src/contracts/organization.contract.ts`)
```ts
// #907: each field is checked only when present; an unknown key is a 400.
export const OrganizationUpdateRequestSchema = z
  .object({
    name: nameField().optional(),
    defaultStationId: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.defaultStationId !== undefined, {
    message: "Provide a name or a default station",
  });
export type OrganizationUpdateRequest = z.infer<typeof OrganizationUpdateRequestSchema>;

export const OrganizationUpdateResponseSchema = z.object({ organization: OrganizationSchema });
export type OrganizationUpdateResponse = z.infer<typeof OrganizationUpdateResponseSchema>;
```
`nameField()` trims, requires 1 character, caps at 120 and says "Name is required" (`text-limits.contract.ts:28`). `strict-request-bodies.test.ts` and `name-length.guard.test.ts` pick the schema up automatically.

### Core — audit (`packages/core/src/models/audit-log.model.ts:22`)
`AUDIT_ACTIONS` gains `"org.update"` after `"org.delete"`, with a comment: "#907: an org field changed; metadata `{ field, from, to }`". No migration (text enum, no CHECK).

### Core — FAQ (`packages/core/src/content/faq.util.ts`)
A new entry before "How do I delete my organization?": **"How do I rename my organization?"**, `FAQCategory.Organization`. It covers Settings → Organization → Rename; who can (permission to edit the organization); names don't need to be unique; the new name shows at once in the switcher and on invoices; and the delete confirmation expects the new name.

### API — permission plumbing
- `permission-set.ts` `ACTION_MAP` (:53): `"org.write": { verb: "write", resourceType: "org" }`.
- `permission.service.ts` `PermissionAction` (:44): add `| "org.write"`. `permissionMaps` (:225) then computes it through `set.can`, with no `DERIVED_CAPABILITIES` change.
- `permission-refusal.ts` `ACTION_PHRASES`: `"org.write": "edit the organization"` → "You don't have permission to edit the organization."

### API — `StripeService.updateCustomerName` (`apps/api/src/services/stripe.service.ts`, after `createCustomer`)
```ts
/** #907: keep the customer's name in step with an org rename. */
static async updateCustomerName(customerId: string, name: string): Promise<void> {
  await StripeService.client().customers.update(customerId, { name });
}
```

### API — `OrganizationUpdateService` (new `apps/api/src/services/organization-update.service.ts`)
```ts
export interface OrganizationUpdatePatch { name?: string; defaultStationId?: string | null }
export interface OrganizationUpdateResult { organization: Organization; previousName: string }

export class OrganizationUpdateService {
  /** One transaction: lock the row (`FOR UPDATE`), read its name, write only the
   *  present fields plus `updated`/`updatedBy`, return the row and the name it
   *  replaced. Throws `ApiError(404, ORGANIZATION_NOT_FOUND)` for a missing or
   *  deleted org. */
  static apply(orgId: string, patch: OrganizationUpdatePatch, userId: string): Promise<OrganizationUpdateResult>;

  /** Post-commit, best effort. A no-op without a customer id or when Stripe isn't
   *  configured. A failure logs `warn` with { organizationId, stripeCustomerId,
   *  error } ("…reconcile manually") and never throws. */
  static syncStripeCustomerName(organization: Organization): Promise<void>;
}
```

### API — `PATCH /api/organization/:id` (`organization.router.ts:169-245`)
In order:
1. If `id !== metadata.organizationId`, return `404 ORGANIZATION_NOT_FOUND`. This runs before parsing, so another org's id is never told about its body.
2. `OrganizationUpdateRequestSchema.safeParse(req.body)`. On failure, `invalidPayload(ORGANIZATION_INVALID_PAYLOAD, "Invalid organization update payload", error)` → 400.
3. Load the permission set once:
   - If `name` is present: `set.check("org.write")`, else `403 PERMISSION_DENIED`.
   - If `defaultStationId` is present: `set.check("resource.write", {type:"station"})`, then the existing non-null station lookup (404 `STATION_NOT_FOUND`).
   - Both checks run before any write.
4. `OrganizationUpdateService.apply(id, parsed.data, userId)`.
5. If `name` was present and `organization.name !== previousName`:
   - `void AuditService.record({ ...auditContextFromRequest(req), action: "org.update", targetType: "organization", targetId: id, metadata: { field: "name", from: previousName, to: organization.name } })`;
   - `void OrganizationUpdateService.syncStripeCustomerName(organization)`.

   An unchanged name still writes `updated`, and records nothing.
6. `HttpService.success<OrganizationUpdateResponse>(res, { organization })`.

The `catch` keeps today's 500 mapping (`ORGANIZATION_FETCH_FAILED`).

**@openapi:** summary "Update organization settings". The description names both fields and their permissions (`org.write` for `name`, class station write for `defaultStationId`). The request body is `$ref OrganizationUpdateRequest`, 200 is `$ref OrganizationUpdateResponse`, and 400, 403, 404 and 500 use `$ref ApiErrorResponse`. Both components are registered in `swagger.config.ts` via `z.toJSONSchema`.

**Route map** (`route-authorization.map.ts:573-577`): `by: "caller's org; name → org.write; defaultStationId → class resource.write station + readable station in org"`. `locks` is unchanged (`none`).

### Web — SDK
- `organizations.api.ts`:
  ```ts
  update: (orgId: string) =>
    useAuthMutation<OrganizationUpdateResponse, OrganizationUpdateRequest>({
      url: `/api/organization/${encodeURIComponent(orgId)}`,
      method: "PATCH",
      onPermissionDenied: { invalidate: () => [queryKeys.organizations.root] },
    }),
  ```
- `stations.api.ts:54` `setDefault`: the response type becomes `OrganizationUpdateResponse`.

### Web — `RenameOrganizationDialog` (new `apps/web/src/components/RenameOrganizationDialog.component.tsx`)
This is a pure UI file, the same shape as `RenamePortalDialog`. It holds local form state only.
```ts
export interface RenameOrganizationDialogProps {
  open: boolean; onClose: () => void; currentName: string;
  onSubmit: (name: string) => void; isPending: boolean; serverError?: ServerError | null;
}
```
- It's a `Modal` titled "Rename organization", with `onSubmit`, `submitDisabled` and `pending`.
- The field is labelled "Organization name". It's `required`, auto-focused via `useDialogAutoFocus(open)`, and prefilled with `currentName`.
- It validates with `validateWithSchema(OrganizationUpdateRequestSchema, { name })` and keeps touched/errors. `aria-invalid` and `helperText` are set, and `onBlur` goes through `blurUnlessDialogControl`. A failure runs `focusFirstInvalidField()`.
- Save with the unchanged trimmed name just closes the dialog. Nothing is sent, matching the #801 behaviour in `RenamePortalDialog`.
- It renders `<FormAlert serverError />`, Cancel (`type="button"`), and Save ("Saving..." while pending).

### Web — Settings (`apps/web/src/views/Settings.view.tsx`, Organization section :292-330)
- `const renameMutation = sdk.organizations.update(organization.id)`. Because the hook is keyed by id, the container reads the id from `organizationResult` before rendering.
- A `GatedButton` "Rename" (small, outlined, edit icon) sits beside the name. Its gate is `decideActionGate({ allowed: can("org.write") })` (`hide` when not allowed). `onClick` runs `renameMutation.reset()` and then opens the dialog.
- On submit: `mutate({ name }, { onSuccess: () => { invalidate organizations.root; close } })`. Pass `serverError={toServerError(renameMutation.error)}`. `onClose` calls `reset()`.

### Web — Activity (`AuditLogActivity.component.tsx`)
- A new pure helper `auditActionSummary(row)` in `apps/web/src/utils/audit-summary.util.ts` returns `string | null`.
  - For `org.update` whose metadata has `field: "name"` and string `from`/`to`, it returns `Renamed from "X" to "Y"`.
  - Anything else returns `null`.
- The Action column renders the action and, when the summary isn't null, the summary on a second line in secondary text. Other actions' metadata stays off screen.

## Migration / Seed
None. `org.update` and the `write` verb are text-enum widenings with no CHECK, and the built-in policies are unchanged.

## TDD test plan
Run tests through the npm scripts, never jest directly:
- `cd packages/core && npm run test:unit -- --testPathPattern …`
- `cd apps/api && npm run test:unit -- …`
- `cd apps/api && npm run test:integration -- …`
- `cd apps/web && npm run test:unit -- …`

### Core (≈ 9)
- `__tests__/contracts/organization.contract.test.ts` (6 cases):
  - name-only, station-only, null station, and both, all valid;
  - `{}` → the refine message;
  - an unknown key, a blank or whitespace name, and a 121-character name are rejected;
  - the name is trimmed.
- `__tests__/models/permission.model.test.ts`: `CAPABILITY_PAIRS` gains `org.write ↔ write org`, and `org` verbs include `write` (2 cases).
- `__tests__/models/audit-log.model.test.ts`: `org.update` parses (1 case).
- The existing `faq.util.test.ts` covers shape.

### API unit (≈ 7)
- `__tests__/services/stripe.service.test.ts`: `updateCustomerName` calls `customers.update(id, { name })` (1 case).
- New `__tests__/services/organization-update.service.test.ts`, `syncStripeCustomerName` (3 cases): no customer → no call; not configured → no call; Stripe throws → warn and resolve.
- `permission-refusal` test: the `org.write` phrase (1 case).
- The capability fixtures gain `org.write`, with no new cases.

### API integration (≈ 16)
`organization.router.integration.test.ts`, PATCH block:
- Name-only, as owner and as admin → 200 with the new name, and `defaultStationId` unchanged (2 cases).
- A member → `403 PERMISSION_DENIED`, the message names "edit the organization", and the row is unchanged (1 case).
- A member granted `write org` through a custom policy → 200 (1 case).
- Station-only behaves as #690 (still 403 for a member) (1 case).
- Both fields together require both permissions (1 case).
- `{}`, an unknown key, a blank name and a 121-character name → `400 ORGANIZATION_INVALID_PAYLOAD` (4 cases).
- Another org's id → 404 before validation (1 case).
- A rename writes one `org.update` entry with `{field, from, to}` and the actor; an unchanged name writes none (2 cases).
- Stripe: with a customer and Stripe mocked, `updateCustomerName` is called once; with Stripe rejecting, the response is still 200 (2 cases).
- Two concurrent renames each record the `from` they replaced, and the final row matches the last writer (1 case).
- The full capability-map assertion (:210) gains `org.write`.

`same-org-access.authorization.integration.test.ts`: an `org.write` agreement test, member false → 403 and owner true → 200 (1 case). `permission-loadset.integration.test.ts` maps gain the key.

The route-map and OpenAPI guard tests pass unchanged.

### Web (≈ 22)
- New `__tests__/RenameOrganizationDialog.test.tsx`: the full Dialog & Form Test Checklist (renders / closed / click submit / Enter submit / pending blocks close / Cancel-on-empty shows no error / onClose / loading / FormAlert shown / hidden / field errors / aria-invalid / required), plus "unchanged name closes without onSubmit" and "121-character paste shows the limit error, not truncated" (15 cases).
- `__tests__/SettingsView.test.tsx`:
  - Rename is shown when `org.write` is true and hidden when false;
  - a successful submit invalidates `organizations.root` (spy);
  - a 403 shows in the dialog's FormAlert (4 cases).
- New `__tests__/audit-summary.util.test.ts`: a rename summary, a non-`name` field → null, another action → null (3 cases).
- `__tests__/AuditLogActivity.test.tsx`: an `org.update` row shows the summary (1 case).
- The snapshot is updated only if Settings' rendered tree changes for a fixture with `org.write`.

**Totals ≈ 54 cases.**

## Acceptance criteria
- [ ] A caller with `write org` (Owner and Admin by default, or a member given it by a custom policy, a group or a grant) sees Rename on Settings → Organization. Renaming updates the tab, the header and the switcher without a reload.
- [ ] A caller without it sees no Rename. A direct PATCH with `name` answers `403 PERMISSION_DENIED`, "You don't have permission to edit the organization."
- [ ] A name-only PATCH leaves `defaultStationId` unchanged. A station-only PATCH behaves as #690.
- [ ] These are refused with `400 ORGANIZATION_INVALID_PAYLOAD`: an empty or whitespace name, a name over 120 characters, an unknown key, and `{}`. The dialog shows the inline error after blur or submit and never truncates a paste.
- [ ] Enter submits exactly when Save could. The dialog can't be dismissed while pending. A server error shows in FormAlert with the input intact.
- [ ] Two orgs may share a name.
- [ ] After a rename, the delete confirmation expects the new name.
- [ ] Settings → Activity shows `Renamed from "X" to "Y"` with the actor.
- [ ] With a Stripe customer, the customer's name matches after the rename. With Stripe down, the rename still succeeds and a warning is logged.
- [ ] A PATCH to another org's id answers 404.

## Risks & rollback
- **A client that relied on `{}` clearing the station.** None in the code (`setDefault` always sends the key), and the integration test pins station-only behaviour.
- **Fixture churn.** `CapabilityMap` is exhaustive, so every typed fixture across core, api and web needs `org.write`. The full root build and type-check catches a missed one ([[feedback_core_model_change_run_full_build]]).
- **Failure modes.** The rename fails closed: no write without the permission, and a DB error is a 500 with nothing written. Audit and Stripe are fail-open by design. The cost of a stale Stripe name is cosmetic, and it's logged for reconciliation.
- **Rollback.** Revert the PR. No schema changed. `org.update` rows already written stay readable, since the Activity falls back to the raw action.

## Files touched
- **Core:** `models/permission.model.ts`, `contracts/organization.contract.ts`, `models/audit-log.model.ts`, `content/faq.util.ts`, plus tests (`organization.contract.test.ts`, `permission.model.test.ts`, `audit-log.model.test.ts`).
- **API:**
  - `services/permission-set.ts`, `services/permission.service.ts`, `services/permission-refusal.ts`, `services/stripe.service.ts`;
  - new `services/organization-update.service.ts`;
  - `routes/organization.router.ts`, `config/swagger.config.ts`, `__tests__/config/route-authorization.map.ts`;
  - tests: `organization.router.integration.test.ts`, `same-org-access.authorization.integration.test.ts`, `permission-loadset.integration.test.ts`, `stripe.service.test.ts`, new `organization-update.service.test.ts`, and the capability fixtures.
- **Web:**
  - `api/organizations.api.ts`, `api/stations.api.ts`;
  - new `components/RenameOrganizationDialog.component.tsx` (+ story), `views/Settings.view.tsx`;
  - new `utils/audit-summary.util.ts`, `components/AuditLogActivity.component.tsx`;
  - tests: new `RenameOrganizationDialog.test.tsx` and `audit-summary.util.test.ts`, plus `SettingsView.test.tsx`, `AuditLogActivity.test.tsx` and the capability fixtures.

## Next step
`docs/ORG_RENAME.plan.md` slices this into about five commits on `feat/907-org-rename`:
1. Core: vocabulary, contract and audit action, with fixtures swept.
2. API: the permission plumbing, Stripe method and update service.
3. API: the PATCH rewrite, OpenAPI and route map, with integration tests.
4. Web: SDK, dialog and Settings wiring.
5. Web and core: Activity summary and FAQ.
