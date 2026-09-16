# Members/Team UI (invite, list, roles) — Discovery

**Issue:** [EnterpriseBT/portal-ai#585](https://github.com/EnterpriseBT/portal-ai/issues/585)

**Why this exists.** #584 shipped the seats backend (invitations, `SeatService`, accept, member list/remove/re-role) but it has no UI — an owner can only manage seats via `curl`. This ticket is the user-facing surface: an owner/admin-only Settings **Members/Team** tab with a Members section (re-role, remove) and a Pending-invitations section (revoke, resend, copy link), a Zod invite dialog that surfaces the returned invite link (no email is sent), an **accept landing route** the invite link points at, and a seat-usage (used/cap) indicator. This is the front end that completes the multi-user story for a subscription customer — the last of the seats trio (#583 → #584 → #585).

## The current shape

### Settings view + addressable tabs (#284/#576)
| Piece | Location | Note |
|---|---|---|
| Settings view | `apps/web/src/views/Settings.view.tsx:48` | flat MUI `Tabs`/`TabPanel` via `useTabs`; panels gated by `tabsProps.value === N` so queries fire only when active |
| Tab seed (read-once) | `Settings.view.tsx:52` + `utils/routes.util.ts:38` (`SettingsTab`, `SETTINGS_TAB_INDEX`) | seeded at mount from `?tab=`; clicks do **not** rewrite the URL (read-once, unlike Help) |
| Route validate | `apps/web/src/routes/settings.tsx:17` | `validateSearch` accepts the `SettingsTab` values |
| Role gating (#576) | `Settings.view.tsx:108,142,347` | `Activity` tab wrapped in `isAdminOrOwner`; danger-zone `disabled={!isOwner}`; hidden-tab deep-link bounces to tab 0 (`:114-120`) |

### Role gating + denied states
`useRole()` (`apps/web/src/utils/use-role.util.ts:22`, from `sdk.organizations.current()`) → `{ role, isOwner, isAdmin, isAdminOrOwner, roleKnown }`. Denied recognition: `utils/permission-denied.util.ts` (`isPermissionDenied`, `PERMISSION_DENIED_CODES`, `PERMISSION_DENIED_MESSAGE`). Denied views: `views/Forbidden.view.tsx` (403), `views/Unauthorized.view.tsx` (401), over `components/HttpError.component.tsx`.

### SDK / API layer
`api/<domain>.api.ts` → aggregated in `api/sdk.ts:31`; `useAuthQuery`/`useAuthMutation` (`utils/api.util.ts:129,189`); keys in `api/keys.ts` (`organizations` at `:28`). Mutation factories **don't self-invalidate** — the consuming view's `onSuccess` calls `queryClient.invalidateQueries({ queryKey: queryKeys.<domain>.root })` (pattern: `Stations.view.tsx:143`). End-to-end exemplar: `stations.api.ts` → `queryKeys.stations` → `Stations.view.tsx`.

### Form & Dialog + Toast
Canonical dialog: `components/CreateStationDialog.component.tsx` — `Modal` + `slotProps.paper={{component:"form",onSubmit}}` (`:165`), `useDialogAutoFocus` (`:89`), `validateWithSchema`→`FormErrors`, `focusFirstInvalidField()` (`:141`), `aria-invalid` (`:205`), `<FormAlert serverError=…/>` (`:320`); test checklist `CLAUDE.md:527`. Toasts: `useToast()` (`utils/toast.context.tsx:68`), provider in `providers/Toast.provider.tsx` — action outcomes outside a dialog (revoke/resend/remove/re-role/copy) raise toasts.

### Routing + the accept-landing auth gap
File routes under `apps/web/src/routes/` (`createFileRoute`); no `_authorized` layout file — routes compose `<Authorized><AuthorizedLayout>` (`settings.tsx:24`). `Authorized` (`components/Authorized.component.tsx:40`) redirects unauthenticated users to `/login` (search preserved). **The gap:** Auth0 login hardcodes `redirect_uri: window.location.origin` with **no `appState`/`returnTo`** (`api/auth.api.ts:19,36`, `Application.provider.tsx:45`), so a brand-new invitee sent to login lands on `/` and loses `?token=`.

### Contracts (already shipped by #584)
`packages/core/src/contracts/invitation.contract.ts`: `InviteCreateRequest` (email+role, refuses owner), `AcceptInvitationRequest` (`token`), `InvitationResponse` (no `tokenHash`, transient `inviteUrl`), `InvitationListResponse`, `Member`, `MemberListResponse` (`{members}`), `AcceptInvitationResponse`. `MemberRoleUpdateRequest` in `organization.contract.ts:52`. **`seatUsage` is not on the wire** — `MemberListResponseSchema` is `{members}` only; `GET /members` (`apps/api/src/routes/organization.router.ts` + `SeatService.listMembers`) returns just `{members}`.

### Component conventions
Settings sub-panels are plain `*.component.tsx` in `apps/web/src/components/` (e.g. `AuditLogActivity.component.tsx`, `SubscriptionBilling.component.tsx`), tests in `apps/web/src/__tests__/`, stories in `apps/web/src/stories/`. Component File Policy (`CLAUDE.md:133`): ≤2 components/file, container + pure-`UI` split. The accept landing gets its own `views/…View` + `routes/invitations.accept.tsx`.

## The design space

### Decision 1 — Placement: a read-once Settings tab, owner/admin-only (settled at ticket time)
Add `Members = "members"` to `SettingsTab` + `SETTINGS_TAB_INDEX` (`routes.util.ts`), to `validateSearch` (`settings.tsx`), and render a `<Tab>`/`<TabPanel>` gated by `isAdminOrOwner` (mirroring the Activity tab). `GET /members` is already owner/admin-only, so a member never sees the tab and is bounced from a deep link (existing `:114` guard). **Lean: Settings tab, `isAdminOrOwner`, read-once** — consistent with #576's gating; no new surface pattern.

### Decision 2 — Accept-landing token survival through login
The invite link is `${WEB_APP_URL}/invitations/accept?token=…`; the accept POST needs an authed caller, so a not-yet-logged-in invitee must log in and return **with the token**.

- **A — Auth0 `appState` + `onRedirectCallback`.** `loginWithRedirect({ appState: { returnTo: location.pathname + location.search } })`; an `onRedirectCallback` on `Auth0Provider` navigates to `appState.returnTo`. Idiomatic Auth0-React; survives the round trip cleanly.
- **B — Stash token in `sessionStorage` before `/login`.** The accept route, when unauthenticated, saves the token then redirects to login; a post-login effect reads it and resumes. Works without touching the Auth0 provider config, but is stateful/implicit and easy to strand.
- **C — Rely on first-login self-heal only.** Point the link at `/` and let the verified-email self-heal (#584) bind the org. Rejected at ticket time (already-existing users with an invite to another org don't auto-accept; the token path goes unused).

| | A appState/returnTo | B sessionStorage | C self-heal only |
|---|---|---|---|
| Token survives login | ✓ | ✓ (fragile) | n/a (email-match) |
| Deterministic / token-secured | ✓ | ✓ | ✗ |
| Touches Auth0 provider wiring | yes (small) | no | no |

**Lean: A.** Add `appState.returnTo` at `loginWithRedirect` call sites + an `onRedirectCallback` that routes to `returnTo` (default `/`). It's the one piece of genuinely new plumbing and fixes a latent limitation (no returnTo anywhere today) that future deep-links benefit from.

### Decision 3 — `seatUsage` on `GET /members`
Extend `MemberListResponseSchema` → `{ members, seatUsage: { used: number; max: number | null } }` and have `SeatService.listMembers` also compute `used = live members + pending-active invites`, `max = tier maxSeats` (reuse the private seat-count/tier helpers already in `SeatService`). One fetch powers the list + the usage indicator; additive (older callers ignore the new field).

**Lean: extend `GET /members` with `seatUsage`.** Chosen at ticket time; avoids a second endpoint/query key. Register the widened component in `swagger.config.ts`.

### Decision 4 — Component shape
Container + pure-UI split (Component File Policy): `MembersTab.component.tsx` (container: wires `useRole`, the members/invitations queries, mutations, toasts) delegating to `MembersTabUI`. Sub-components as their own files: `MemberList` (rows: role + re-role select [owner-only] + remove), `PendingInvitationList` (rows: email/role/expiry + revoke/resend/copy-link), `InviteMemberDialog` (Form & Dialog pattern), and a reused confirm dialog for remove. Re-role: an inline role `Select` (owner-only, disabled on owner rows) with a confirm, or a small dialog — **Lean: inline select + confirm dialog** (fewer clicks than a full dialog; matches the lightweight action).

**Lean: one container tab + pure-UI children per file**, tests in `__tests__/`, stories in `stories/`.

### Decision 5 — Query keys + invalidation
New `queryKeys.members` + `queryKeys.invitations` roots (or nest under `organizations`). Invite → invalidate `invitations.root` + `members.root` (seatUsage rides on members). Revoke/resend → `invitations.root` (+ members for seatUsage). Remove/re-role → `members.root`. Accept (landing) → invalidate `organizations.root` (current org may change) + navigate home.

**Lean: two new roots; view-owned `onSuccess` invalidation** (house pattern).

## Tradeoff comparison

| | D1 tab | D2 appState | D3 seatUsage on /members | D4 container+UI | D5 two roots |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes (+backend) | Yes | Yes |
| New backend change | no | no | yes (small) | no | no |
| New pattern | no | returnTo (new) | no | no | no |

## Recommendation

1. A read-once **Members/Team Settings tab**, rendered only for `isAdminOrOwner`; add `Members` to `SettingsTab`/`SETTINGS_TAB_INDEX` + `settings.tsx` `validateSearch`.
2. The tab has **Members** (re-role owner-only, remove owner/admin, last-owner-remove disabled) and **Pending invitations** (revoke, resend, copy-link) sections, each a pure-UI child under a `MembersTab` container.
3. An **`InviteMemberDialog`** (Form & Dialog pattern, `InviteCreateRequestSchema`) that on success surfaces the returned `inviteUrl` to copy.
4. An **accept landing** `route/view` at `/invitations/accept?token=…` (wrapped in `<Authorized>`) that calls `POST /invitations/accept` and lands the user in the invited org; wire Auth0 **`appState.returnTo` + `onRedirectCallback`** so a not-yet-logged-in invitee returns to the link post-login.
5. Extend **`GET /members` with `seatUsage {used, max}`** (backend: `MemberListResponseSchema` + `SeatService.listMembers` + swagger); render used/cap in the tab, cap-aware (unlimited when `max === null`).
6. **SDK**: `invitations` + `members` api files (invite/list/revoke/resend/accept, list-members/remove, re-role via existing `organization` role endpoint) on `sdk`, with `queryKeys.members`/`invitations`; view-owned invalidation.
7. **Role-gated affordances backed by server enforcement**: re-role owner-only; invite/remove owner+admin; invite disabled at the cap with a reason; denied → `Forbidden` + toast.

## Open questions

1. **Copy-invite-link availability.** `inviteUrl` (plaintext token) is returned **only** on invite/resend (the list stores the hash, not the token). So a pending row can't show a persistent copy-link — only **resend** (which mints a fresh link). **Lean: show a copyable link on invite-success + resend-success; pending rows offer resend + revoke, not a stored link.** (Confirm this UX is acceptable given the token is never persisted.)
2. **Auth0 `onRedirectCallback` routing.** TanStack Router is created outside the Auth0 provider; the callback needs a way to navigate (router `history.push` or a small pending-`returnTo` bridge). **Lean: store `returnTo` from `appState` and navigate via the router once mounted** (a tiny effect), rather than coupling the provider to the router instance.
3. **Already-a-member accept.** An existing user who opens a link for an org they're already in → `acceptByToken` is idempotent (no dup). **Lean: the landing shows "You're already a member" success and routes into that org.**
4. **Seat-usage display when `max === null`.** **Lean: show just the member count (e.g. "5 members"); show "used / max" only when a cap is set.**
5. **Re-role target constraints in the UI.** Owner role is immutable via the API (#576). **Lean: the role select is disabled on the owner row and rendered only for owners (owner-only action); admin↔member is the only transition offered.**

## Enterprise-scale considerations

- **Concurrency & correctness.** UI never optimistically mutates seat state — it refetches via `invalidateQueries`, and the server is the arbiter (a lost seat-cap race returns `409 SEAT_LIMIT_EXCEEDED` → toast). N/A for deeper races (backend #584 owns the advisory lock).
- **Failure modes.** UI gating is convenience only; **server enforcement is the boundary** (a member hitting `/members` directly still 403s). Denied → `Forbidden`/toast, fail-safe (hide affordance, don't fake success).
- **Scale & unbounded growth.** `GET /members` returns the full list (no pagination). Bounded by the seat cap for capped tiers; an unlimited (enterprise) org could be large. **Lean: render all for now; note keyset pagination as a follow-up** — member counts are realistically modest and the seat cap bounds most tiers. Prototype-grade acceptable because the cardinality is seat-bounded and enterprise orgs negotiate separately.
- **Multi-tenancy.** The tab is scoped to the current org (`useRole`/`current`); switching orgs re-seeds it. No cross-tenant leakage — every call is org-scoped server-side.
- **Contract stability.** `seatUsage` is an additive field; the accept `returnTo` wiring is generic (any future deep-link reuses it). SSO (#577) invitees reuse the same accept route + self-heal.
- **Accuracy/auditability, Data lifecycle.** N/A — all mutations already audited server-side (#584); the UI adds no new record-of-truth.

## What this doesn't decide

- **Backend seats logic** — done in #584; this ticket adds only the `seatUsage` field to `GET /members`.
- **Email delivery of invites** — no email infra; the UI surfaces a copyable link (a provider is a separate ticket).
- **Member-list pagination/search** — deferred (seat-bounded cardinality); add keyset if an enterprise org needs it.
- **Enterprise SSO (#577)** and **custom org-defined roles** (later RBAC child).

## Next step

`docs/MEMBERS_UI.spec.md` pins: the `seatUsage` addition to `MemberListResponseSchema` + `SeatService.listMembers` + `GET /members` (+ swagger); the `sdk.members`/`sdk.invitations` endpoints + `queryKeys`; the `MembersTab` container + `MembersTabUI` + `MemberList`/`PendingInvitationList`/`InviteMemberDialog` component contracts (props); the accept `route/view` + the Auth0 `appState.returnTo`/`onRedirectCallback` wiring; and the role-gating map. `docs/MEMBERS_UI.plan.md` then slices it — (1) `seatUsage` backend + SDK/keys; (2) Members tab + list + re-role/remove; (3) invite dialog + pending-invitations section; (4) accept landing route + returnTo wiring — each a green, testable commit on `feat/members-ui` → PR into `epic/security-readiness`.
