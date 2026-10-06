# Permission refusals and hints name permissions, not roles — Spec

This spec pins the vocabulary pass over every permission refusal and hint:
- one refusal code, `PERMISSION_DENIED`;
- a message that names the missing permission, derived from the checked action and object;
- one display helper shared by dialogs and toasts;
- copy that names access, not roles;
- a guard that keeps role framing out.

Discovery: `docs/PERMISSION_REFUSAL_COPY.discovery.md`. Issue: [#711](https://github.com/EnterpriseBT/portal-ai/issues/711) (child of epic #684).

## Key decisions (flag for review)

1. **One code** (discovery D1-A): `ApiCode.PERMISSION_DENIED` replaces `INSUFFICIENT_ROLE`, `BILLING_NOT_OWNER`, `ORGANIZATION_NOT_OWNER` and `AUDIT_LOG_NOT_AUTHORIZED`. It's a clean rename with no alias, accepted as a **breaking API change** (OQ4) and recorded in the PR body.
2. **The message names the permission** (D2-B). It's derived from `(action, object)` by `permissionRefusalMessage`, in a new text-only file (`permission-set.ts` contains NUL bytes). The fallback is "You don't have permission to perform this action." No structured `details` (D2-C is deferred).
3. **A tenancy refusal isn't a permission refusal** (D4). The cross-org connector-instance create gets a new `ORGANIZATION_MISMATCH` (403). Job cancel becomes `PERMISSION_DENIED`, "…to cancel this job".
4. **The role-assignment rule stays** (OQ1). `seat.service.ts:665-675` keeps its role check and its message ("Only the owner can assign or remove the owner or admin role"). *Revised in slice 1:* it can't keep its code, because that code was `INSUFFICIENT_ROLE`, so it gets its own `MEMBER_ROLE_ASSIGNMENT_RESTRICTED` (403). It's a rule about roles, not a permission, so `PERMISSION_DENIED` would mislabel it. It's an accepted heuristic about roles, and the guard allowlists that exact string. The same holds for `LAST_OWNER_*`, `MEMBER_MIN_ONE_ROLE` and `RBAC_SYSTEM_IMMUTABLE`.
5. **Hints name no one** (OQ2): "Ask for access to …".
6. **Clients show the server's message as the lead** for a denial, since it now names the permission, falling back to the standard lead only when it's empty. The `(CODE)` caption stays (D3-B, revised now that the message is specific).
7. **The marketing site needs nothing extra** (OQ3): editing the core help strings is enough.
8. **The guard is fail-closed on drift**: a role-framed refusal phrase anywhere outside the allowlist fails CI. Files are read as UTF-8 text, never through `grep`.

## Scope

### In scope

- The API codes, `permissionRefusalMessage`, `PermissionSet.check`, the middleware, and the jobs and connector-instance throw sites.
- The web `serverErrorMessage` helper, `FormAlert`, the 15 raw toasts, and `PERMISSION_DENIED_CODES`.
- Copy:
  - the Views hint;
  - Accept Invitation;
  - the FAQ and glossary;
  - `system.prompt.ts`;
  - the route JSDoc 403 descriptions;
  - stale comments.
- Two guard tests (api, and web plus core content).
- Docs: CLAUDE.md, its mirror, and `ENTERPRISE_SSO.runbook.md:52`.

### Out of scope

- Any authorization decision: who may do what is unchanged.
- The owner/admin role-assignment rule (Key decision 4).
- A "who can grant this" lookup (OQ2).
- Structured error `details`.
- Codes about roles (Key decision 4).

## Surface

### `ApiCode` (`apps/api/src/constants/api-codes.constants.ts`)

- **Remove:** `ORGANIZATION_NOT_OWNER` (`:50`), `INSUFFICIENT_ROLE` (`:58`), `BILLING_NOT_OWNER` (`:109`), `AUDIT_LOG_NOT_AUTHORIZED` (`:788`), with their comments, including the stale `:786-787`.
- **Add** (plus `MEMBER_ROLE_ASSIGNMENT_RESTRICTED`, see Key decision 4):

```ts
/** #711: the caller lacks the permission the action needs. The message names
 *  it ("You don't have permission to manage billing."). Policies govern
 *  permissions, so this never says which role. */
PERMISSION_DENIED = "PERMISSION_DENIED",
/** #711: the request names an organization other than the caller's current
 *  one. A tenancy refusal, not a permission. */
ORGANIZATION_MISMATCH = "ORGANIZATION_MISMATCH",
```

### `permissionRefusalMessage` + `permissionDenied` (new `apps/api/src/services/permission-refusal.ts`)

```ts
export const PERMISSION_DENIED_FALLBACK =
  "You don't have permission to perform this action.";

/** "You don't have permission to <phrase>." for a checked action. */
export function permissionRefusalMessage(
  action: PermissionAction,
  object?: PermissionObject
): string;

/** The 403 every permission refusal throws. */
export function permissionDenied(
  action: PermissionAction,
  object?: PermissionObject
): ApiError; // new ApiError(403, ApiCode.PERMISSION_DENIED, permissionRefusalMessage(action, object))
```

**Phrases**, before the final "." (`{one}`/`{many}` come from the label table below):

| Action | Object | Phrase |
|---|---|---|
| `billing.manage` | — | `manage billing` |
| `org.delete` | — | `delete the organization` |
| `org.audit.read` | — | `view the audit log` |
| `member.role.assign` | — | `change members' roles` |
| `member.invite` | — | `invite members` |
| `member.remove` | — | `remove members` |
| `resource.read` | `id` set / unset | `view this {one}` / `view {many}` |
| `resource.write` | `id` set / unset | `edit this {one}` / `create or edit {many}`* |
| `resource.delete` | `id` set / unset | `delete this {one}` / `delete {many}` |
| `resource.share` | `id` set / unset | `share this {one}` / `share {many}` |
| `resource.view` | any (`page`) | `view this page` |
| any `resource.*` | missing, or a type not in the table | → `PERMISSION_DENIED_FALLBACK` |

\* An id-less `write` serves both creates and entity-wide actions such as re-validate, so it doesn't claim "create".

**Labels** (`{one}` / `{many}`):

| Type | Labels |
|---|---|
| `station` | station / stations |
| `pin` | pinned result / pinned results |
| `curated_view` | view / views |
| `portal` | portal / portals |
| `entity` | entity / entities |
| `entity_record` | record / records |
| `field_mapping` | field mapping / field mappings |
| `connector_instance` | connector / connectors |
| `connector_definition` | connector definition / connector definitions |
| `entity_group` | entity group / entity groups |
| `tag` | tag / tags |
| `column_definition` | column definition / column definitions |
| `job` | job / jobs |
| `toolpack` | toolpack / toolpacks |

### `PermissionSet.check` (`permission-set.ts:60-82, 102-105`)

- `denyCode` and `denyMessage` are deleted.
- `check` throws `permissionDenied(action, object)`.
- No other line of `permission-set.ts` changes. That keeps the NUL-byte sentinels (`:212-213`) untouched.

### Other throw sites

- **`middleware/require-permission.middleware.ts:40-44`** (missing context): `new ApiError(403, ApiCode.PERMISSION_DENIED, PERMISSION_DENIED_FALLBACK)`.
- **`middleware/require-permission.middleware.ts:51-55`**: `permissionDenied(action, { type: resourceType })`.
- **`routes/jobs.router.ts:379`**: `new ApiError(403, ApiCode.PERMISSION_DENIED, "You don't have permission to cancel this job.")`.
- **`routes/connector-instance.router.ts:765`**: `ApiCode.ORGANIZATION_MISMATCH`, keeping its message.
- **The OpenAPI route JSDoc 403 descriptions** read "The caller lacks permission to <phrase>." with no role names and no old codes:
  - `toolpacks.router.ts:348, 508, 648, 750, 852`;
  - `billing.router.ts:150, 233`;
  - `organization.router.ts:279, 537, 598, 910, 1406, 1463`;
  - `role.router.ts:37, 72`, `group.router.ts:39, 69`, `policy.router.ts:37, 71`, `rbac-object-search.router.ts:56`.
- **Stale comments:** `organization.router.ts:346, 1504`.

### Agent

- `permission-gate.service.ts:157` changes from "You do not have permission to …" to "You don't have permission to …", matching the API. `:162-168` (relaying `err.message`) is unchanged; it now relays a permission-framed message.
- `prompts/system.prompt.ts`:

| Line | Before | After |
|---|---|---|
| `:457` | "The catalog is admin-curated; you cannot create new column definitions." | "The catalog is curated; you cannot create new column definitions." |
| `:469` | "ask their admin to add the missing column definitions" | "ask someone with access to column definitions to add them" |
| `:802` | "Column definitions are admin-only — you cannot create new ones." | "You cannot create new column definitions." |

### Web

- **`apps/web/src/utils/permission-denied.util.ts`:**
  - `PERMISSION_DENIED_CODES = new Set(["PERMISSION_DENIED"])`.
  - `PERMISSION_DENIED_MESSAGE` is unchanged.
  - Add the helper below.
  - Fix the comment at `:7-8`, which falsely claims the toasts use it.

```ts
/** #711: what to show for a server error. A denial shows the server's
 *  message (it names the permission), or the standard lead if it's empty;
 *  anything else shows its message, or `fallback`. */
export function serverErrorMessage(
  error: unknown,
  fallback = "Something went wrong."
): string;
```

- **`components/FormAlert.component.tsx:21-29`:** the main text is `serverErrorMessage(serverError)`, and the caption is `(code)` for every error. A denial no longer stacks the lead over a duplicate detail.
- **The 15 raw toasts** become `toast.error(serverErrorMessage(err, <the site's existing fallback>))`:
  - `MembersTab.component.tsx:268, 285, 332, 347`
  - `Toolpacks.view.tsx:466, 526`
  - `EntityGroupDetail.view.tsx:664, 685`
  - `EntityDetail.view.tsx:737, 793`
  - `EditLayoutPlan.view.tsx:667, 705, 716`
  - `ShareDialog.component.tsx:387`
  - `StationDetail.view.tsx:142`
- **Copy:**

| Location | After |
|---|---|
| `views/CuratedViews.view.tsx:182` | "Ask for access to create views" |
| `views/AcceptInvitation.view.tsx:61` | "Ask the person who invited you for a fresh invite link." |
| `:67` | "It may have already been used or been revoked. Ask the person who invited you to resend it." |
| `:79` | "Something went wrong. Please try again, or ask the person who invited you to resend it." |
| `SubscriptionBilling.component.tsx:78` | stale comment fixed |

### Help content (`packages/core/src/content/`; also rendered by `apps/site`)

| Entry | After |
|---|---|
| `faq.util.ts:91-93`, "Who can manage billing?" | "Anyone with permission to manage billing. Everyone can see the available plans on Settings → Subscription & Billing, but Subscribe and Manage subscription are enabled only for those with that permission — the server enforces this too, so it isn't just hidden buttons." |
| `faq.util.ts:194` | "Only someone with permission to delete the organization can delete it, and the action is permanent: …" (rest unchanged) |
| `glossary.util.ts:451` (Boundary) | "It stops anyone from authoring a policy (or bundling one into a role/group) that would exceed their own permissions." |
| `glossary.util.ts:453` | "Someone without permission to manage billing can't create a policy granting it, because they don't hold it themselves." |
| `glossary.util.ts:469` | "Anyone with permission to manage billing can upgrade to a paid plan …" |
| `glossary.util.ts:478` | "…where anyone with permission to manage billing manages the subscription …" |

### Guards

**`apps/api/src/__tests__/permission-copy.guard.test.ts`** (new)
- **Scans:** every `.ts` under `apps/api/src`, excluding `__tests__`, read with `readFileSync(path, "utf8")`.
- **Fails on:**

```ts
const ROLE_FRAMED = [
  /your role/i,
  /\bonly the (organization'?s? )?owner\b/i,
  /\bowner or admin\b/i,
  /\bnot (an |the )?(organization'?s? )?owner\b/i,
  /\bask (an|your|their) admin\b/i,
  /\badmin-(only|curated)\b/i,
  /\b(INSUFFICIENT_ROLE|BILLING_NOT_OWNER|ORGANIZATION_NOT_OWNER|AUDIT_LOG_NOT_AUTHORIZED)\b/,
];
```

- **Allowlist:** exact `{ file, text }` pairs, starting with `services/seat.service.ts` / "Only the owner can assign or remove the owner or admin role". A self-test checks the matcher catches each phrase and ignores an allowlisted one.

**`apps/web/src/__tests__/permission-copy.guard.test.ts`** (new)
- **Scans:** `.ts`/`.tsx` under `apps/web/src` (excluding `__tests__` and `stories`) and `packages/core/src/content`.
- **Fails on:** the same `ROLE_FRAMED` list.
- **Allowlist:** empty. The role-management UI (`MemberList`'s "last owner", the role menu, "Your roles") matches none of these phrases. This was checked against the survey list.

### Docs

- **CLAUDE.md → "API Style Guide" → Error codes:** a permission refusal throws `permissionDenied(action, object)` (`PERMISSION_DENIED`), and its message names the permission, never a role. A rule *about* roles (last owner, role assignment) may name roles.
- **CLAUDE.md → "Action Affordances":** a grant hint says what access is needed ("Ask for access to …"), never who to ask by role.
- **`.github/copilot-instructions.md`:** the same two sentences.
- **`docs/ENTERPRISE_SSO.runbook.md:52`:** "owner-only Settings → Activity" becomes "Settings → Activity (needs permission to view the audit log)".

## Migration

None.

## Seed

None.

## TDD test plan

Run with the package scripts:
- `cd apps/api && npm run test:unit && npm run test:integration`
- `cd apps/web && npm run test:unit`
- `cd packages/core && npm run test:unit`

### Layer 1: api unit

`apps/api/src/__tests__/services/permission-refusal.test.ts` (new):
1. Each named action gives its phrase (`billing.manage`, `org.delete`, `org.audit.read`, `member.*`). 6 cases.
2. `resource.read`/`write`/`delete`/`share` with and without an id, on one type each (8 cases); `resource.view` on a page.
3. An id-less `resource.write` says "create or edit", never "create" alone.
4. The fallback for a missing object and for an unknown type.
5. `permissionDenied` returns 403 `PERMISSION_DENIED` with that message.

Other api unit tests:

6. `permission-set.test.ts`: the billing, org-delete, audit and generic refusals now assert `PERMISSION_DENIED` plus the derived message (replacing the four-code assertions).
7. `permission-gate.service.test.ts`: the relayed 403 carries the permission-framed text, and the gate's own message reads "You don't have permission …".
8. `system.prompt.test.ts`: the prompt contains none of "admin-only", "admin-curated" or "ask their admin".

### Layer 2: api integration

9. The 13 + 3 + 2 + 2 files asserting the old codes switch to `PERMISSION_DENIED`. Billing, org delete and audit also assert the derived message.
10. `connector-instance.router.integration.test.ts`: the cross-org create returns 403 `ORGANIZATION_MISMATCH`.
11. Job cancel by a non-controller returns `PERMISSION_DENIED`, "You don't have permission to cancel this job." (`nav-object-enforcement.integration.test.ts`).
12. `require-permission` middleware (where integration-tested via toolpacks or RBAC routes): `PERMISSION_DENIED` plus the derived message.

### Layer 3: api guard

13. `permission-copy.guard.test.ts`: no role-framed phrase outside the allowlist; the matcher self-test; the allowlist entry still exists (shrink-only).

### Layer 4: web

14. `permission-denied.util.test.ts` (new or extended), `serverErrorMessage`:
    - a denial with a message returns the message;
    - a denial with an empty message returns the lead;
    - a non-denial returns its message;
    - an `Error`, `null` or unknown value returns the fallback.
15. `FormAlert.test.tsx`: a `PERMISSION_DENIED` error shows its message once, with the caption `(PERMISSION_DENIED)`. The role-text expectation is removed.
16. `auth-mutation-permission-denied.test.tsx`: `onPermissionDenied` fires on `PERMISSION_DENIED`, and not on an old code.
17. Toasts: `MembersTab.test.tsx` and `EntityGroupDetailView.test.tsx` (representative). A denied mutation's toast shows the server's permission message.
18. `CuratedViewsView.test.tsx`: the hint "Ask for access to create views".
19. AcceptInvitation: the three bodies (in its existing test, or a new one).
20. `permission-copy.guard.test.ts` (web plus core content): no role-framed phrase, plus the matcher self-test.

### Layer 5: core

21. `faq.util.test.ts` and `glossary.util.test.ts`: the billing, org-delete and boundary entries contain no "owner"/"admin" refusal phrasing, and do contain "permission".

**Totals ≈ 55 cases.** Most are assertion updates in existing integration files, plus about 30 new cases.

## Acceptance criteria

- A refused action returns `403 {"code":"PERMISSION_DENIED","message":"You don't have permission to <phrase>."}`. No refusal says "role", "owner" or "admin", except the owner/admin role-assignment rule.
- A dialog shows that message once, with `(PERMISSION_DENIED)`. A toast shows the same message, never "Your role …".
- Views' Create hint reads "Ask for access to create views". Accept Invitation never says "admin".
- The FAQ and glossary (in the app and on the marketing site) describe billing and org delete by permission.
- The agent, refused by a tool, relays a permission-framed reason. Its prompt doesn't call column definitions "admin-only".
- Creating a connector instance in another org returns `ORGANIZATION_MISMATCH`, not a permission code.
- CI fails if a role-framed refusal phrase is added outside the allowlist.

## Risks & rollback

- **External API consumers matching the old codes break.** Accepted (OQ4), with the breaking change named in the PR body. Nothing in-repo matches them (survey §5).
- **A wrong phrase in the label table** (e.g. a grammatical slip) would show in every refusal of that type. The Layer 1 cases cover every type and verb.
- **The NUL-byte file:** the change to `permission-set.ts` is limited to `check` and the deleted helpers, so the sentinels at `:212-213` must survive. The integration suite exercises them.
- **Fail mode:** unchanged. Refusals stay fail-closed, and this is wording and naming only.
- **Rollback:** revert the PR. No data is involved.

## Files touched

- **API:**
  - `constants/api-codes.constants.ts`
  - `services/permission-refusal.ts` (new)
  - `services/permission-set.ts`
  - `middleware/require-permission.middleware.ts`
  - `routes/jobs.router.ts`, `routes/connector-instance.router.ts`
  - route JSDoc in `toolpacks`, `billing`, `organization`, `role`, `group`, `policy` and `rbac-object-search` routers
  - `services/permission-gate.service.ts`
  - `prompts/system.prompt.ts`
  - `__tests__/permission-copy.guard.test.ts` (new) and the test updates in the TDD plan
- **Web:**
  - `utils/permission-denied.util.ts`
  - `components/FormAlert.component.tsx`
  - the 7 toast files (15 sites)
  - `views/CuratedViews.view.tsx`, `views/AcceptInvitation.view.tsx`
  - `components/SubscriptionBilling.component.tsx` (comment)
  - `__tests__/permission-copy.guard.test.ts` (new) and the test updates
- **Core:** `content/faq.util.ts`, `content/glossary.util.ts`, plus tests.
- **Docs:** `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/ENTERPRISE_SSO.runbook.md`.

## Next step

`/plan 711` (`docs/PERMISSION_REFUSAL_COPY.plan.md`, on this branch) slices this into about four TDD commits:
1. **Server:** codes, `permission-refusal.ts`, `check`, the middleware and throw sites, with the unit and integration updates.
2. **Web:** `serverErrorMessage`, `FormAlert`, the toasts and the copy.
3. **Help, prompt, route JSDoc and the gate's wording.**
4. **The guards and docs.**

The guards come last, because they fail until slices 1–3 have removed every phrase.
