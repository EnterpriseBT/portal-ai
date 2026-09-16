# Members/Team UI (invite, list, roles) — Spec

**Issue:** [EnterpriseBT/portal-ai#585](https://github.com/EnterpriseBT/portal-ai/issues/585) · **Epic:** #578 · **Discovery:** `docs/MEMBERS_UI.discovery.md`

Pins the contract for #585: the apps/web front end for the #584 seats backend — an owner/admin-only Settings **Members/Team** tab (Members + Pending-invitations), a Zod **invite dialog** surfacing the returned copyable link, an **accept landing route** with Auth0 `appState.returnTo` wiring, a **seat-usage** indicator — plus one additive backend change: `GET /members` returns `seatUsage {used, max}`.

## Key decisions (from resolved discovery)

1. **Placement (D1):** a read-once Settings **Members** tab, rendered only for `isAdminOrOwner` (mirrors #576's Activity gating; `GET /members` is owner/admin-only server-side). Hidden entirely for members.
2. **Accept token survival (D2, confirmed):** Auth0 **`appState.returnTo` + `onRedirectCallback`** so a not-yet-logged-in invitee returns to `/invitations/accept?token=…` after login.
3. **Seat usage (D3):** extend `GET /members` → `{ members, seatUsage: { used, max } }` (additive); `used = live members + pending-active invites`, `max = tier maxSeats` (null = unlimited).
4. **Components (D4/D5):** `MembersTab` container + `MembersTabUI` + `MemberList`/`PendingInvitationList`/`InviteMemberDialog` (Component File Policy); two new query-key roots; view-owned invalidation.
5. **Copy-link (OQ1):** `inviteUrl` is shown only on invite/resend success (token stored hashed); pending rows offer **resend** (new link) + revoke, not a stored link.
6. **Role gating is convenience; the server is the boundary** — denied → `Forbidden`/toast.

## Scope

### In scope
1. Backend: `MemberListResponseSchema` gains `seatUsage`; `SeatService.seatUsage`; `GET /members` returns it; swagger.
2. SDK: `sdk.members` (list, remove, changeRole) + `sdk.invitations` (list, create, revoke, resend, accept); `queryKeys.members`/`invitations`.
3. Settings **Members tab** (`MembersTab` + pure-UI children) with Members + Pending-invitations sections + seat-usage indicator.
4. **`InviteMemberDialog`** (Form & Dialog pattern).
5. **Accept landing** route/view + Auth0 `appState.returnTo`/`onRedirectCallback` + `returnTo` bridge.

### Out of scope
Backend seats logic (#584); email delivery; member-list pagination/search; SSO (#577); custom roles.

## Surface

### Backend — `seatUsage` on `GET /members`

**`packages/core/src/contracts/invitation.contract.ts`** — extend:
```ts
export const SeatUsageSchema = z.object({
  used: z.number().int().nonnegative(),
  max: z.number().int().nullable(), // null = unlimited
});
export const MemberListResponseSchema = z.object({
  members: z.array(MemberSchema),
  seatUsage: SeatUsageSchema,
});
```
(`MemberListResponse` type updates automatically.) Register `SeatUsage`/updated `MemberListResponse` in `apps/api/src/config/swagger.config.ts`.

**`apps/api/src/services/seat.service.ts`** — add a **non-throwing** display helper (distinct from the fail-closed `admit`/`tierMaxSeatsFor`):
```ts
static async seatUsage(caller: PermissionContext): Promise<{ used: number; max: number | null }>
```
`PermissionService.check(caller, "member.invite")`; `used = organizationUsers.count(org) + invitations.countPendingActive(org, now)`; `max` = the org's tier `maxSeats` (org→tier→`tiers.findBySlug`), **null when the tier can't be resolved** (a display value never blocks; enforcement stays in `admit`). `listMembers` is unchanged (still returns `Member[]`).

**`apps/api/src/routes/organization.router.ts`** — `GET /members` handler now returns `{ members: await SeatService.listMembers(ctx), seatUsage: await SeatService.seatUsage(ctx) }` (both already gated by `member.invite`). `@openapi` response → updated `MemberListResponse`.

### SDK (`apps/web/src/api/`)

**`api/keys.ts`** — add roots:
```ts
members: { root: ["members"] as const, list: () => [...] },
invitations: { root: ["invitations"] as const, list: () => [...] },
```

**`api/members.api.ts`** (new) — on `sdk.members`:
- `list(options?)` → `useAuthQuery<MemberListResponse>(queryKeys.members.list(), "/api/organization/members")`.
- `remove()` → `useAuthMutation<void, { userId: string }>({ method: "DELETE", url: (v) => \`/api/organization/members/${v.userId}\`, body: () => undefined })`.
- `changeRole()` → `useAuthMutation<MemberRoleUpdateResponse, { userId; role }>({ method: "PATCH", url: (v) => \`/api/organization/members/${v.userId}/role\`, body: (v) => ({ role: v.role }) })`.

**`api/invitations.api.ts`** (new) — on `sdk.invitations`:
- `list(options?)` → `useAuthQuery<InvitationListResponse>(queryKeys.invitations.list(), "/api/organization/invitations")`.
- `create()` → `useAuthMutation<InvitationResponse, InviteCreateRequest>({ method: "POST", url: "/api/organization/invitations" })`.
- `revoke()` → `useAuthMutation<InvitationResponse, { id }>({ method: "POST", url: (v) => \`…/invitations/${v.id}/revoke\`, body: () => undefined })`.
- `resend()` → same shape, `…/${v.id}/resend`.
- `accept()` → `useAuthMutation<AcceptInvitationResponse, { token }>({ method: "POST", url: "/api/organization/invitations/accept" })`.

Register both on `api/sdk.ts`. Invalidation is **view-owned** (`onSuccess`): invite/revoke/resend → `invitations.root` + `members.root` (seatUsage rides on members); remove/changeRole → `members.root`; accept → `organizations.root`.

### Web components (`apps/web/src/components/`, Component File Policy)

- **`MembersTab.component.tsx`** — `MembersTab` (container: `useRole`, `sdk.members.list`, `sdk.invitations.list`, the mutations, `useToast`, invalidation) → `MembersTabUI` (pure: props `{ members, invitations, seatUsage, role, isPending flags, onInvite, onChangeRole, onRemove, onRevoke, onResend, serverError }`).
- **`MemberList.component.tsx`** — `MemberListUI` (pure): rows with name/email/role; a role `Select` shown **only for owners**, disabled on the owner row (owner immutable, #576); a Remove button disabled for the last owner + own row, with tooltip.
- **`PendingInvitationList.component.tsx`** — `PendingInvitationListUI` (pure): rows email/role/expiry + Resend / Revoke; resend/invite success shows a **copyable invite link** (a small copy affordance).
- **`InviteMemberDialog.component.tsx`** — `InviteMemberDialogUI` (pure): Form & Dialog pattern (`Modal` + `slotProps.paper.component="form"`, `useDialogAutoFocus`, `validateWithSchema(InviteCreateRequestSchema)`, `FormErrors`+`focusFirstInvalidField`, `aria-invalid`, `<FormAlert serverError>`); fields email + role (member|admin, no owner); on success the parent shows the returned `inviteUrl` to copy.
- **Remove confirmation** — a lightweight confirm dialog (reuse the app's confirm pattern; no type-to-confirm needed — removal is reversible-ish/soft-delete).
- **Seat usage** — a small indicator in `MembersTabUI`: `"{used} / {max}"` when `max !== null`, else `"{used} members"`.

### Settings wiring
- **`apps/web/src/utils/routes.util.ts`** — `SettingsTab.Members = "members"`; insert into `SETTINGS_TAB_INDEX` (order: Profile 0, Organization 1, Billing 2, **Members 3, Activity 4**).
- **`apps/web/src/routes/settings.tsx`** — `validateSearch` accepts `"members"`.
- **`apps/web/src/views/Settings.view.tsx`** — render `<Tab>`/`<TabPanel>` for Members **gated by `isAdminOrOwner`** (mirror the Activity gating + the existing hidden-tab deep-link bounce at `:114`).

### Accept landing + Auth0 returnTo
- **`apps/web/src/routes/invitations.accept.tsx`** (new) — `createFileRoute` with `validateSearch` → `{ token: string }`; renders `AcceptInvitationView` wrapped in `<Authorized>` (so a logged-out invitee is sent to login first).
- **`apps/web/src/views/AcceptInvitation.view.tsx`** (new) — reads `token`, calls `sdk.invitations.accept({ token })` once on mount; states: pending (spinner), success (→ invalidate `organizations.root`, toast, navigate to `/`), already-a-member (idempotent success), error (`404`/`410` → clear message + a "back to app" affordance).
- **`apps/web/src/api/auth.api.ts`** — `withGoogle(returnTo?)` passes `appState: { returnTo }` (default current `location.pathname + location.search`) alongside the existing params.
- **`apps/web/src/providers/Application.provider.tsx`** — `Auth0Provider` gains `onRedirectCallback={(appState) => setPostLoginReturnTo(appState?.returnTo)}` writing a `sessionStorage` key `portalai-post-login-returnto`; a small `usePostLoginReturnTo()` effect in the authed shell reads it once and `navigate`s (the router is created inside the provider, so the callback can't navigate directly — OQ2).
- **`apps/web/src/components/Authorized.component.tsx`** — when redirecting a logged-out user, trigger login with `returnTo = location.pathname + location.search` so the token survives (rather than the bare `/login` → `/` round trip).

## Migration / Seed
None — no DB schema change (`seatUsage` is computed). Say so explicitly.

## TDD test plan

Run via npm scripts (`cd apps/api && npm run test:integration`; `cd apps/web && npm run test:unit`; `cd packages/core && npm run test:unit`). Web component tests render the **pure UI** components (no SDK/router mocks).

### Layer 1 — backend seatUsage (api integration + core unit)
1. `seat.service.integration`: `seatUsage` returns `{used: members+pending, max}`; `max=null` when tier has no cap; reflects a set cap; counts a pending invite. (extend the suite)
2. `organization.router.invitations.integration`: `GET /members` returns `{members, seatUsage}` with the right `used`/`max`; still owner/admin-only (member → 403). (extend)
3. `packages/core` contract test: `MemberListResponseSchema` requires `seatUsage`; `SeatUsageSchema` rejects negative `used`, accepts `max:null`.

### Layer 2 — web components (web unit, pure UI)
4. `MemberListUI`: renders rows; role `Select` present only for owner caller, disabled on owner row; Remove disabled for last owner + self (tooltip).
5. `PendingInvitationListUI`: rows with resend/revoke; empty state.
6. `InviteMemberDialogUI`: the full Dialog & Form Test Checklist (renders open/closed, submit/Enter, cancel, loading, FormAlert present/absent, field errors + `aria-invalid` + `required`, rejects `owner`/bad email); on success the copy-link affordance shows the `inviteUrl`.
7. `MembersTabUI`: seat-usage indicator ("used / max" vs "used members"); wires section callbacks; cap-reached disables invite with a reason.
8. `AcceptInvitationView`: pending/success/already-member/404/410 states from the mutation result.

### Layer 3 — settings + routing (web unit)
9. `routes.util`: `settingsTabIndexFromSearch("?tab=members")` → the Members index; unknown → 0.
10. Settings view: Members tab rendered for owner/admin, **absent** for member (mirror the Activity test).

**Totals:** ~3 backend, ~5 component, ~2 routing ≈ **10+ cases**. No migration test (no schema change). The accept `returnTo`/`onRedirectCallback` round trip is verified in the smoke walk (auth redirect isn't unit-testable here).

## Acceptance criteria

- [ ] An owner/admin sees a Members/Team tab; a member does not, and any direct API call is denied server-side.
- [ ] Owner/admin can invite (and copy the returned link), resend/revoke pending invites; owner can re-role (admin↔member); owner/admin can remove; the last owner can't be removed.
- [ ] Seat usage shows `used / max` when a cap is set, `used` alone when unlimited; inviting past the cap is blocked with a clear message (server `409` surfaced).
- [ ] An invitee opening the invite link — logged out or in — is bound to the invited org and lands in the app (token survives login via `returnTo`).
- [ ] `npm run lint`, `type-check`, and unit/integration suites pass across api + web + core.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Token lost through login. | `appState.returnTo` + `onRedirectCallback` + `Authorized` login trigger; smoke-walked. |
| UI shows an affordance the server denies. | Gating from `useRole`; server is the boundary — denied → `Forbidden`/toast (fail-safe). |
| `seatUsage.max` throws on unresolvable tier. | `seatUsage` is **non-throwing** (max=null); only `admit` fail-closes. |
| Copy-link confusion (no persistent link). | Link shown on invite/resend only; pending rows resend to mint a new one (token is hashed). |

**Rollback:** revert the branch. `seatUsage` is additive (older FE ignores it); the accept route + returnTo wiring are new and self-contained.

## Files touched

**New:** `apps/web/src/api/{members,invitations}.api.ts`, `apps/web/src/components/{MembersTab,MemberList,PendingInvitationList,InviteMemberDialog}.component.tsx`, `apps/web/src/routes/invitations.accept.tsx`, `apps/web/src/views/AcceptInvitation.view.tsx`, + `__tests__`/`stories`. **Edit:** `packages/core/src/contracts/invitation.contract.ts`, `apps/api/src/services/seat.service.ts`, `apps/api/src/routes/organization.router.ts`, `apps/api/src/config/swagger.config.ts`, `apps/web/src/api/{sdk,keys}.ts`, `apps/web/src/utils/routes.util.ts`, `apps/web/src/routes/settings.tsx`, `apps/web/src/views/Settings.view.tsx`, `apps/web/src/api/auth.api.ts`, `apps/web/src/providers/Application.provider.tsx`, `apps/web/src/components/Authorized.component.tsx`.

## Next step

`docs/MEMBERS_UI.plan.md` slices this into ~4 TDD commits on `feat/members-ui`: (1) `seatUsage` backend + contract + swagger + SDK/keys; (2) Members tab + `MemberList` + re-role/remove + seat-usage indicator; (3) invite dialog + `PendingInvitationList` (revoke/resend/copy-link); (4) accept route + `AcceptInvitationView` + Auth0 `returnTo` wiring. Each green + compilable; server enforcement already in place from #584.
