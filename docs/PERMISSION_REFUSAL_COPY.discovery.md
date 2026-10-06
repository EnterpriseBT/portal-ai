# Permission refusals and hints name permissions, not roles — Discovery

**Issue:** [EnterpriseBT/portal-ai#711](https://github.com/EnterpriseBT/portal-ai/issues/711) · Bug · child of epic #684 · branch `fix/711-permission-refusal-copy` (from `epic/per-object-action-affordances`)

**Why this exists.** Portals AI is policy-based RBAC: **policies govern permissions, and roles and groups only package policies.** A custom policy, a group or a direct grant can give anyone `billing.manage` or `write tag`. The refusals and hints still describe a role-based world:
- Every permission refusal is `403 INSUFFICIENT_ROLE`, "Your role does not permit this action".
- Billing and org delete refuse with `BILLING_NOT_OWNER` / `ORGANIZATION_NOT_OWNER`, "Only the organization owner can …".
- The Views Create hint says "Ask an owner or admin".
- Accept Invitation says "Ask an admin".

Users see all of it. `FormAlert` puts the role text and the code under its permission-framed lead, and 15 toasts show the server message raw. The portal agent relays it too, because the tool permission gate passes `err.message` through. The help content shared with the marketing site says "Only the organization owner can manage billing".

The copy teaches the wrong model, and it's wrong for anyone whose access comes from a custom policy. This ticket is the vocabulary pass that makes every refusal and hint say which **permission** is missing.

## The current shape

### Where refusals come from (server)

| Source | Location | Today |
|---|---|---|
| `PermissionSet.check` refusals | `apps/api/src/services/permission-set.ts:60-82` (`denyCode`, `denyMessage`), thrown at `:104` | `billing.manage` → `BILLING_NOT_OWNER` "Only the organization owner can manage billing"<br>`org.delete` → `ORGANIZATION_NOT_OWNER` "Only the organization owner can delete the organization"<br>`org.audit.read` → `AUDIT_LOG_NOT_AUTHORIZED` (falls through to the generic message)<br>everything else → `INSUFFICIENT_ROLE` "Your role does not permit this action" |
| Middleware | `middleware/require-permission.middleware.ts:40-44, 51-55` | `INSUFFICIENT_ROLE`, the same message |
| Boundary refusals (already right) | `permission-set.ts:173-177, 216-220` | `RBAC_*_EXCEEDS_BOUNDARY`: "You cannot grant access you do not have …" |
| Codes | `constants/api-codes.constants.ts:50, 58, 109, 788` | the comments say "not the org's owner", "The caller's role lacks…"; `:786-787` is stale ("owner-gated; widens to role='admin'") |

Throw sites using `INSUFFICIENT_ROLE` for something other than a policy refusal:
- **`routes/jobs.router.ts:379`**, "You can only cancel jobs you started": an ownership/permission refusal (`JobControlService.canControl`).
- **`routes/connector-instance.router.ts:765`**, "You can only create connector instances in your current organization": a **tenancy** refusal (the body names another org). It isn't a permission at all.
- **`services/seat.service.ts:675`**, "Only the owner can assign or remove the owner or admin role": a rule *about roles*, checked with `caller.roles.includes("owner")` (`:665`) and no policy.

Codes that are genuinely about roles, which stay:
- `LAST_OWNER_REMOVAL` (`seat.service.ts:520`)
- `LAST_OWNER_ROLE_REMOVAL` (`:693`)
- `MEMBER_MIN_ONE_ROLE` (`:589, 633`)
- `RBAC_SYSTEM_IMMUTABLE`

### How clients see them

- **Web:**
  - `utils/permission-denied.util.ts:10-19` lists the four codes (`PERMISSION_DENIED_CODES`) and the lead "You don't have permission to perform this action."
  - `components/FormAlert.component.tsx:21-29` shows the lead, plus `message (code)` as a caption.
  - `utils/api.util.ts:234` uses `isPermissionDenied` for `onPermissionDenied` invalidation.
  - **15 of 20 `toast.error(` calls show the raw message with no lead**:
    - `MembersTab.component.tsx:268, 285, 332, 347`
    - `Toolpacks.view.tsx:466, 526`
    - `EntityGroupDetail.view.tsx:664, 685`
    - `EntityDetail.view.tsx:737, 793`
    - `EditLayoutPlan.view.tsx:667, 705, 716`
    - `ShareDialog.component.tsx:387`
    - `StationDetail.view.tsx:142`
  - No web code branches on a specific denial code.
- **Agent:**
  - `services/permission-gate.service.ts:162-168` turns any thrown 403 into `TOOL_PERMISSION_DENIED`, carrying `err.message`.
  - The gate's own text is already right: "You do not have permission to ${verb} this ${resourceType}." (`:157`).
  - `prompts/system.prompt.ts` names roles at `:457` ("admin-curated"), `:469` ("ask their admin to add…") and `:802` ("Column definitions are admin-only").
- **OpenAPI:**
  - `ApiErrorResponse.code` is a free string (`config/swagger.config.ts:733-750`).
  - The role framing lives in route JSDoc 403 descriptions:
    - `toolpacks.router.ts:348, 508, 648, 750, 852` ("INSUFFICIENT_ROLE");
    - `billing.router.ts:150, 233`;
    - `organization.router.ts:279, 537, 598, 910, 1406, 1463`;
    - `role.router.ts:37, 72`, `group.router.ts:39, 69`, `policy.router.ts:37, 71`, `rbac-object-search.router.ts:56`.
  - Many routes already say "The caller lacks permission … (#685)".
- **CLIs, e2e, site:** no references to these codes.

### Copy that names roles

| Kind | Location |
|---|---|
| Grant hint | `views/CuratedViews.view.tsx:182` "Ask an owner or admin for access to create views". The only role-named hint; the other `useCreateGate` hints say "Ask for access to create …" |
| Invitation | `views/AcceptInvitation.view.tsx:61, 67, 79` "Ask an admin … to (re)send". Sending invites is the `member.invite` permission |
| Help (also on the marketing site, #311) | `packages/core/src/content/faq.util.ts:93` (billing), `:194` (delete org)<br>`glossary.util.ts:469, 478` (billing)<br>`glossary.util.ts:453` ("…because their own role denies it") |
| Already permission-framed | `SubscriptionBilling.component.tsx:65-66` "You don't have permission to manage billing." (its comment at `:78` is stale) |
| **Roles as the subject: stays** | `MemberList.component.tsx:204`<br>`InviteMemberDialog.component.tsx:160-161` (role menu)<br>`Settings.view.tsx:249, 490-491`<br>`DeleteAccessItemDialog.component.tsx:23-26`<br>the glossary Role/Policy entries (`:424, 433`) |

### Tests and docs

- **Tests:**
  - `INSUFFICIENT_ROLE` appears in 13 api test files and 1 web (`auth-mutation-permission-denied.test.tsx`).
  - The billing, org and audit codes appear in 2–3 api files each.
  - `FormAlert.test.tsx` pins the billing message; `CuratedViewsView.test.tsx` pins the role-named hint.
  - No test pins the full `ApiCode` set.
- **Docs:**
  - CLAUDE.md (`:248` onPermissionDenied, `:252-262` ActionGate) and the Copilot mirror (`:33, 35`) describe feedback but not refusal wording.
  - `docs/ENTERPRISE_SSO.runbook.md:52` says "owner-only Settings → Activity" (stale).
- **A trap:** `permission-set.ts` contains NUL bytes (sentinels at `:212-213`), so plain `grep` skips it as binary. Use `grep -a`, and the guard must read files as text.

## The design space

### Decision 1 — The refusal code(s)

**A. One code, `PERMISSION_DENIED`,** replacing `INSUFFICIENT_ROLE`, `BILLING_NOT_OWNER`, `ORGANIZATION_NOT_OWNER` and `AUDIT_LOG_NOT_AUTHORIZED`. The message carries the specific permission.
**B. Rename each to a permission-named code** (`PERMISSION_DENIED`, `BILLING_PERMISSION_DENIED`, …).
**C. Keep the codes and fix only the messages.**

| | A: one code | B: renamed family | C: messages only |
|---|---|---|---|
| Code names a role | No | No | **Yes**: users still see `INSUFFICIENT_ROLE` in `FormAlert` |
| Clients that branch per code | None today (survey §3) | Kept, but unused | Unchanged |
| `isPermissionDenied` | One code | Four | Four |
| Matches the model (one `check`, many actions) | Yes | Partly | No |

**Lean: A.** No client distinguishes the four codes; they're one refusal from one `check`, varied only by the action, and the action belongs in the message, not the code name. Clean rename, no alias (your no-compat-alias rule).

### Decision 2 — What the message says

**A. One generic message:** "You don't have permission to perform this action."
**B. A permission-specific message derived from the action and object**, e.g. "You don't have permission to manage billing", "…to create tags", "…to delete this connector". It comes from a small label map over `PermissionAction` plus the object's type and verb, falling back to A.
**C. B, plus a structured `details: { action, resourceType? }`** on the error, for programmatic use.

| | A: generic | B: derived | C: B + details |
|---|---|---|---|
| Tells the user what's missing | No | **Yes** | Yes |
| The agent can relay it usefully | Barely | Yes | Yes |
| Contract surface | None | The message only | A new error field |

**Lean: B.** The point of the fix is naming the permission. The tool gate already does exactly this (`permission-gate.service.ts:157`), so reuse its phrasing pattern. `details` (C) has no consumer, so it's deferred.

### Decision 3 — How clients display a refusal

**A. Leave `FormAlert` as is,** and make the server message good, so the caption reads well.
**B. One shared `describeServerError(error)` helper** returns the lead plus the server's detail for a denial, or the plain message otherwise. `FormAlert` and **all 15 raw toasts** use it.
**C. B, and drop the `(CODE)` caption** for denials.

| | A | B | C |
|---|---|---|---|
| Toasts get the lead | No (15 sites stay raw) | **Yes** | Yes |
| One place decides denial wording | No | Yes | Yes |
| Support can still read the code | Yes | Yes | No |

**Lean: B.** The issue's toast finding needs it, and `permission-denied.util.ts:7-8` already claims toast surfaces use it, which they don't. Keep the code caption (C drops something support uses).

### Decision 4 — The misfiled `INSUFFICIENT_ROLE` sites

- **`jobs.router.ts:379` (job cancel):** a permission refusal → `PERMISSION_DENIED`, "You don't have permission to cancel this job". It follows `JobControlService`'s rule, which a policy can grant.
- **`connector-instance.router.ts:765` (cross-org body):** tenancy, not permission → its own code, e.g. `ORGANIZATION_MISMATCH` (403), keeping its message.
- **`seat.service.ts:675` (owner/admin role assignment):** see Open question 1.

**Lean: as listed.** A tenancy refusal must not be lumped into a permission code: it's a different fix for the user.

### Decision 5 — The guard

**A. None:** rely on review.
**B. A test that scans for role-framed refusal copy:**
- Scope: `apps/api/src` `ApiError` messages, `apps/web/src` strings, the core `content/` help, and `system.prompt.ts`. Files are read as text, which handles the NUL bytes.
- Phrases: "your role", "only the (organization )?owner", "owner or admin", "ask (an|your) admin", `INSUFFICIENT_ROLE`.
- An explicit allowlist of role-subject files (seat.service role rules, the member-management UI, the glossary Role entry).

**Lean: B.** It's the same shape as #708's guard, and the drift is silent: nothing breaks when "ask an admin" comes back.

## Tradeoff comparison

| | D1 one code | D2 derived message | D3 shared helper | D4 per-site | D5 guard |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. Replace `INSUFFICIENT_ROLE`, `BILLING_NOT_OWNER`, `ORGANIZATION_NOT_OWNER` and `AUDIT_LOG_NOT_AUTHORIZED` with one `ApiCode.PERMISSION_DENIED`. Clean rename, no alias; update every throw site, test and route JSDoc.
2. `denyMessage` (and the middleware) derive "You don't have permission to <phrase>" from the action and the object's type and verb, using a label map beside `denyCode`, with the generic lead as the fallback.
3. Job cancel throws `PERMISSION_DENIED` ("…to cancel this job"). The cross-org connector-instance create throws a new `ORGANIZATION_MISMATCH`.
4. A web `describeServerError(error)` gives the denial lead plus detail. `FormAlert` and the 15 raw `toast.error(...)` sites use it, and `PERMISSION_DENIED_CODES` becomes `{ "PERMISSION_DENIED" }`.
5. Hints and copy name the access needed:
   - Views: "Ask for access to create views".
   - Accept Invitation: "Ask someone who can invite members to send a new invite".
   - FAQ and glossary: billing, org delete, and the boundary example. These ship to the marketing site, so check them in its build.
   - `system.prompt.ts:457, 469, 802`.
   - Route JSDoc 403 descriptions: "The caller lacks permission to …".
6. A guard test (D5) with an explicit allowlist of role-subject files.
7. Docs: CLAUDE.md "API Style Guide" (refusals use `PERMISSION_DENIED` and name the permission; a rule about roles may name roles), the Copilot mirror, and the stale lines (`api-codes.constants.ts:786-787`, `organization.router.ts:346, 1504`, `SubscriptionBilling.component.tsx:78`, `ENTERPRISE_SSO.runbook.md:52`).

## Open questions

1. **`seat.service.ts:665-675`, "Only the owner can assign or remove the owner or admin role".** **Resolved: keep as is.** Assigning or removing the owner/admin roles isn't a policy permission. The hard-coded owner check is an accepted heuristic, so its message correctly names the roles. #711 leaves this rule, its message and its code alone, and the guard allowlists it.
2. **Who to point to in hints.** **Resolved: name no one.** A user is assumed to know whom to ask in their organization, so a hint says what access is needed ("Ask for access to create views") and stops there. No "who can grant this" lookup.
3. **The marketing site's FAQ/glossary build.** It bakes help content at build time (#311). Lean: changing the strings in core is enough; the site picks them up on its next build. The smoke checks `apps/site` renders the new FAQ text.
4. **External API consumers of `INSUFFICIENT_ROLE`.** No in-repo client branches on it. Custom-toolpack webhooks receive tool *inputs*, not API errors. **Resolved: clean rename, accepted as a breaking API change**, recorded in the PR body.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A. Copy and code naming only; no authorization decision changes.
- **Accuracy & auditability:** Lean: one code makes denial metrics and alerts (and support searches) a single query. The derived message records *which* permission was missing, which `INSUFFICIENT_ROLE` never did.
- **Failure modes:** N/A. Refusals stay fail-closed; a missing label falls back to the generic lead.
- **Scale & unbounded growth:** N/A.
- **Multi-tenancy:** Lean: splitting out `ORGANIZATION_MISMATCH` keeps a tenancy refusal from reading as "you lack permission". That matters for multi-org users, who'd otherwise chase a grant they don't need.
- **Contract stability:** Lean: a single permission-framed code is the stable shape for custom RBAC, SSO and policy-granted access. It can't go stale the way `*_NOT_OWNER` did once billing became grantable.
- **Data lifecycle:** N/A.

## What this doesn't decide

- **The owner/admin role-assignment rule** (Open question 1): kept as an accepted heuristic, unchanged.
- **A "who can grant this" lookup in hints** (Open question 2): not wanted; users know whom to ask.
- **Structured `details` on errors** (D2-C). No consumer yet.
- **Codes about roles** (`LAST_OWNER_*`, `MEMBER_MIN_ONE_ROLE`, `RBAC_SYSTEM_IMMUTABLE`) stay. They describe rules about roles, so naming roles there is accurate.

## Next step

`/spec 711` pins:
- the `PERMISSION_DENIED` and `ORGANIZATION_MISMATCH` codes;
- the action → phrase map and its fallback;
- `describeServerError`;
- the copy table;
- the guard's phrase list and allowlist.

`/plan 711` should slice it roughly as:
1. **Server:** codes, messages and throw sites (TDD on `permission-set.test` and the integration files that assert codes).
2. **Web:** `describeServerError` across `FormAlert` and the toasts, plus the copy.
3. **Help content, prompt and route JSDoc.**
4. **Guard and docs.**
