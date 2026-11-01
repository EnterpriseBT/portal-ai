# Rename an organization from Settings — Discovery

**Issue:** [EnterpriseBT/portal-ai#907](https://github.com/EnterpriseBT/portal-ai/issues/907)

**Why this exists.** An organization's name is fixed at creation. Settings → Organization shows it read-only, and only the operator CLI (`portalai org update --name`) can change it. That CLI writes the row directly: no in-app audit entry, and no Stripe sync. A customer who mistyped the name, or who rebrands, has to ask us, and the name follows them into the org switcher, their invoices and the delete confirmation.

The obvious route, `PATCH /api/organization/:id`, has a trap. It has no body schema and writes `defaultStationId ?? null`, so adding `name` to it as-is would make every rename silently clear the default station.

This is the permission-gated, audited rename that fixes the PATCH contract on the way.

## The current shape

### API

| Piece | Location | Note |
|---|---|---|
| `PATCH /:id` | `apps/api/src/routes/organization.router.ts:169-245` | 404 unless `id === metadata.organizationId` (:178). Casts `req.body` with no schema (:188). Class check `resource.write station` (:195-196). A non-null station must be in the org and readable (:198-219). Writes `defaultStationId ?? null` (:221-225). Returns `{ organization }` (:227). No audit entry, and no 400 in the @openapi block (:134-168). |
| `GET /current` | `organization.router.ts:966`, `orgRoleFields()` :63-84 | Returns `capabilities` from `PermissionService.permissionMaps`. |
| Delete's payload check | `organization.router.ts:342-350` | Already uses `invalidPayload(ORGANIZATION_INVALID_PAYLOAD, …)`; the ApiCode exists (`api-codes.constants.ts:64`). |
| Route map | `__tests__/config/route-authorization.map.ts:573-577` | `by: "caller's org + class resource.write station…"`, `locks: { none: … }`. |

### Permissions

| Piece | Location | Note |
|---|---|---|
| `org` resource type | `packages/core/src/models/permission.model.ts:61` | Exists. |
| `RESOURCE_CAPABILITIES.org` | `permission.model.ts:360` | `verbs: ["delete"]` only, so **`write org` isn't an authorable statement today**. |
| `CALLER_CAPABILITY_ACTIONS` | `permission.model.ts:160-172` | `billing.manage`, `org.delete`, `org.audit.read`, `member.*`, `station.default.set`. `CapabilityMapSchema` is an exhaustive record (:178), so every capability fixture needs the new key. |
| `ACTION_MAP` | `apps/api/src/services/permission-set.ts:53-60` | Dotted action → `{verb, type}`, which is how `org.delete` resolves. |
| `DERIVED_CAPABILITIES` | `apps/api/src/services/permission.service.ts:91-97` | Only `station.default.set`. |
| Built-in policies | `apps/api/src/services/seed.service.ts:723-790` | Owner `* *`: allowed. Admin `* *` minus `deny manage billing` and `deny delete org`: **allowed**. Member: denied (`org` isn't in `DATA_RESOURCE_TYPES`). |
| Pinning tests | `permission.model.test.ts:523-549` (`CAPABILITY_PAIRS`); `same-org-access.authorization.integration.test.ts:430-447` (capability ↔ route agreement for `station.default.set`); full-map assertions in `organization.router.integration.test.ts:210` and `permission-loadset.integration.test.ts:211,227,240` | |

### Contract, audit, Stripe

- **Contract.** `organization.contract.ts` has no update schema. `nameField` (`text-limits.contract.ts:28`) trims, requires at least one character and caps at 120. `strict-request-bodies.test.ts` and `name-length.guard.test.ts` sweep every exported `*RequestSchema`, so a new one is covered automatically.
- **Audit.** `AUDIT_ACTIONS` (`packages/core/src/models/audit-log.model.ts:22-57`) has `org.create` and `org.delete`. The column is a drizzle text enum with no SQL CHECK, so a new action is a core-only change with no migration. `metadata` is jsonb. `AuditService.record` (`audit.service.ts:45`) is fail-open; the call site pattern is `organization.router.ts:390-396`. Activity (`apps/web/src/components/AuditLogActivity.component.tsx:44`) renders the raw action and **shows no metadata**.
- **Stripe.** `StripeService.createCustomer` (`stripe.service.ts:95-105`) is the only customer write; there's no `customers.update`. The best-effort precedent is `OrganizationDeleteService.cancelStripeSubscription` (`organization-delete.service.ts:313-339`): post-commit, try/catch, `logger.warn` with ids. The egress is already classified: `STRIPE_*` in `subprocessor-egress-parity.test.ts:65-67`, Stripe in `SUBPROCESSORS` and in `DEPLOYMENT_SECURITY_REVIEW.md:129,140`.

### Web

- **Settings.** The name is a plain `Typography` (`Settings.view.tsx:315-320`). Gating there uses `useCapabilities().can(...)` (:115-121), and there's no ActionGate in Settings yet. `DeleteOrganizationDialog` takes `organization.name` from `current()` (:442), so it follows a refetch automatically.
- **SDK.** `organizations.api.ts` has no PATCH. The only org PATCH is `sdk.stations.setDefault` (`stations.api.ts:54-62`). It's mistyped as `OrganizationGetResponse` and has `onPermissionDenied` invalidating `organizations.root`.
- **Query keys** (`api/keys.ts:30-37`). `memberships()` sits under `organizations.root`, which `OrgSwitcher` reads (`OrgSwitcher.component.tsx:51`), so invalidating the root refreshes the header and the switcher.
- **Precedents to copy.** `RenamePortalDialog.component.tsx` (+ test), wired in `Portal.view.tsx:80-167` with `GatedButton` + `decideActionGate`.

## The design space

### Decision 1 — Who may rename (settled)

Rename checks `resource.write {type: "org"}`. Owner and Admin hold it through their existing `* *` policies, with **no seed change** (confirmed 2026-10-31). Members don't hold it by default; a custom policy, a group or a direct grant can give it to anyone. This needs `RESOURCE_CAPABILITIES.org.verbs` to gain `"write"`, so the policy editor can author `write org`.

### Decision 2 — How the web learns it may rename

- **A. A caller action `org.write`,** in `CALLER_CAPABILITY_ACTIONS` plus an `ACTION_MAP` entry `org.write → {write, org}`, the way `org.delete` works.
- **B. A derived capability** in `DERIVED_CAPABILITIES`, like `station.default.set`.
- **C. Per-object `capabilities` on the org payload,** as the 10 object types carry.

| | A | B | C |
|---|---|---|---|
| Matches an existing org precedent | yes (`org.delete`) | for a class check on another type | no (org isn't one of the per-object types) |
| Agreement test | copy `station.default.set`'s | same | new plumbing |

**Lean: A.** The org is a singleton with no ownership or instance scope, so the action map is the right home, mirroring `org.delete`.

### Decision 3 — PATCH semantics

- **A. Field-presence gating** on a strict schema. `name` present → `write org` is checked. `defaultStationId` present (string or null) → today's station check runs. Absent fields are untouched, and a body naming both needs both.
- **B. A separate `PATCH /:id/name` route.**

**Lean: A.** One resource, one PATCH. The strict schema is what ends the `?? null` clobber, and it leaves room for timezone later. `stations.setDefault` keeps sending `defaultStationId`, so it behaves exactly as today (#690).

### Decision 4 — Audit shape and display

- **A.** New action `org.update`, written only when the name actually changes, with `metadata: { field: "name", from, to }`. Activity renders a one-line summary for `org.update` ("Renamed from X to Y").
- **B.** Audit it, but leave Activity showing only the action.

**Lean: A.** The acceptance criteria require the old and new name visible in Settings → Activity, and the component shows no metadata today. A per-action summary (not a generic metadata dump) keeps other actions' metadata off screen.

### Decision 5 — Stripe sync

- **A. Post-commit, best effort:** `StripeService.updateCustomerName(customerId, name)` after the row update, when `stripeCustomerId` is set and Stripe is configured. A failure logs a warning with the ids, and the rename still returns 200.
- **B. A queued job** with retries.

**Lean: A.** That's the delete flow's precedent, and the cost of a stale Stripe name is cosmetic until the next rename. A job adds a type and a lock-scope entry for a one-call side effect.

## Tradeoff comparison

|  | `write org` via `* *` | `org.write` caller action | Field-presence PATCH | `org.update` + summary | Best-effort Stripe |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| Migration | No | No | No | No (text enum) | No |

## Recommendation

1. `RESOURCE_CAPABILITIES.org.verbs` becomes `["write", "delete"]`. The built-in policies are unchanged: Owner and Admin hold `write org` through `* *`.
2. Add `org.write` to `CALLER_CAPABILITY_ACTIONS` and `ACTION_MAP`, and copy the `station.default.set` agreement test for it: member false → 403, owner and admin true → 200.
3. `OrganizationUpdateRequestSchema` (core) is `.strict()`, with `name: nameField` optional and `defaultStationId: string | null` optional, plus a refine requiring at least one field. The PATCH `safeParse`s it into `400 ORGANIZATION_INVALID_PAYLOAD`.
4. Each field's check runs only when that field is present. A name-only PATCH never touches `defaultStationId`. Refusals come from `permissionDenied`, naming the permission.
5. When the name changes, write the row, then call `AuditService.record({ action: "org.update", targetType: "organization", metadata: { field: "name", from, to } })`, then push the name to Stripe (best effort). An unchanged name is a no-op: no audit entry, no Stripe call.
6. Correct the PATCH's response contract to `{ organization }` with a registered OpenAPI component, document the 400, and fix `stations.setDefault`'s response type.
7. Web:
   - `sdk.organizations.update` with `onPermissionDenied` invalidating `organizations.root`;
   - a `RenameOrganizationDialog` copied from `RenamePortalDialog`;
   - a `GatedButton` "Rename" in the Organization section via `decideActionGate({ allowed: can("org.write") })`;
   - on success, invalidate `organizations.root`, which refreshes `current` (and so the delete confirmation) and the memberships the switcher reads.
8. Activity renders "Renamed from "X" to "Y"" for `org.update`.
9. Add an FAQ entry for "How do I rename my organization?", shared with the marketing site.

## Open questions

Resolved with the user on 2026-11-01 (all three leans taken):

1. **Empty body.** Today `{}` clears the default station. **Resolved: 400** `ORGANIZATION_INVALID_PAYLOAD`, via the refine. No client sends `{}`, and a no-op hides caller bugs.
2. **Audit the default-station change too?** **Resolved: not in #907.** Filed as #935, which reuses the `org.update` metadata shape (`field`, `from`, `to`).
3. **The CLI's `org update --name` skips the audit and Stripe.** **Resolved: the CLI stays as it is in #907** (per the PRD). Filed as #936 so an operator rename records the audit entry and syncs Stripe.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: two concurrent renames are last-write-wins on the row, and each records its own `from → to` read inside the update's transaction (`UPDATE … RETURNING`, with the prior name read in the same transaction). Stripe calls are post-commit, so a later Stripe success can't record an older name *as the row's*, though Stripe may briefly hold the earlier one. That's cosmetic and acceptable, and the next rename corrects it.
- **Accuracy & auditability.** Lean: `audit_log` is the durable record, with actor, from and to. It's fail-open like every other entry (a lost audit write never blocks the rename), which is the existing policy.
- **Failure modes.** Lean: the rename itself fails closed (no write without `write org`; a DB error is a 500, nothing written). Stripe is fail-open and logged.
- **Scale & unbounded growth.** N/A because a rename is a single-row update and one external call.
- **Multi-tenancy.** Lean: unchanged boundary. A PATCH to another org's id stays a 404, checked before any permission check.
- **Contract stability.** Lean: the strict schema and field-presence gating are the seam for timezone or other org fields later, each with its own check.
- **Data lifecycle.** N/A because there's no retention or window. Names aren't unique (as today), so there's no index change.

## What this doesn't decide

- An agent tool for renaming. The PRD excludes it, and the agent gets no org-write tool.
- Uniqueness of org names. Not enforced, as today.
- Moving the default station onto `write org`. It stays on `station.default.set` (#690).
- Changes to the CLI (OQ3): #936.
- Auditing the default-station change (OQ2): #935.

## Next step

`docs/ORG_RENAME.spec.md` pins the following, then `docs/ORG_RENAME.plan.md` slices the work into commits:
- the schema;
- the capability additions;
- the PATCH's field rules;
- the audit metadata;
- `StripeService.updateCustomerName`;
- the dialog's props.

Expect about five slices:
1. Core: the verb, the capability, the contract and the audit action.
2. API: the PATCH, the audit entry and the Stripe sync, with the agreement test.
3. Web: the SDK, the dialog and its tests.
4. Web: the Settings wiring and the Activity summary.
5. Docs: the FAQ entry.
