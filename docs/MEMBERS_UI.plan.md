# Members/Team UI (invite, list, roles) — Plan

**TDD-sequenced: `seatUsage` backend + SDK → Members tab (list + re-role/remove + usage) → invite dialog + pending-invitations section → accept landing route + Auth0 `returnTo` wiring.**

Spec: `docs/MEMBERS_UI.spec.md`. Discovery: `docs/MEMBERS_UI.discovery.md`. Issue: #585 (epic #578). Builds on shipped #584 (seats backend: invitations, `SeatService`, accept + member endpoints) and #576 (roles + `useRole` gating).

Four slices, each behind a green suite and each leaving the tree compilable. They land as **commits on `feat/members-ui`** (PR #603 → `epic/security-readiness`) — one feature, one PR.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the wire contract first (the SDK + every component depend on `seatUsage` existing), then the read/manage surface (members list + tab gating), then the write-heavy invite/pending section on top of that tab, and finally the standalone accept route + the app-wide `returnTo` wiring (independent of the tab, smoke-verified). No forward deps: each slice consumes only earlier ones.

---

## Slice 1 — `seatUsage` backend + contract + SDK/keys

The additive `seatUsage` on `GET /members` and the SDK surface every component will call. No UI yet.

**Files**

- Edit: `packages/core/src/contracts/invitation.contract.ts` — `SeatUsageSchema`; `MemberListResponseSchema` gains `seatUsage`.
- Edit: `apps/api/src/services/seat.service.ts` — non-throwing `seatUsage(caller)` (`used` = members + pending-active; `max` = tier maxSeats or null).
- Edit: `apps/api/src/routes/organization.router.ts` — `GET /members` returns `{ members, seatUsage }`.
- Edit: `apps/api/src/config/swagger.config.ts` (+ its round-trip test) — register `SeatUsage` + updated `MemberListResponse`.
- New: `apps/web/src/api/members.api.ts`, `apps/web/src/api/invitations.api.ts`; Edit: `apps/web/src/api/{sdk,keys}.ts`.

**Steps**

1. **Tests (spec L1 cases 1–3).** `seat.service.integration`: `seatUsage` = members+pending / `max` null-when-uncapped / reflects a set cap. `organization.router.invitations.integration`: `GET /members` → `{members, seatUsage}`, still member-403. `packages/core` contract: `MemberListResponseSchema` requires `seatUsage`; `SeatUsageSchema` rejects negative `used`, accepts `max:null`. Run; fail.
2. **Implement** the schema, `SeatService.seatUsage`, the route shape, swagger + its mirror, the two SDK api files + keys + `sdk` registration. Green.
3. Lint + type-check (core + api + web). Commit.

**Done when:** L1 cases pass; `GET /members` returns `seatUsage`; `sdk.members`/`sdk.invitations` exist and compile; no UI references them yet.

**Risk:** the swagger round-trip test pins registered components — update it in the same slice (spec §Backend). `seatUsage` must be **non-throwing** (max=null on unresolvable tier), unlike `admit`.

---

## Slice 2 — Members tab: list + re-role/remove + seat-usage indicator

The owner/admin-only Settings tab with the Members section and the usage indicator.

**Files**

- New: `apps/web/src/components/MembersTab.component.tsx` (`MembersTab` container + `MembersTabUI`), `apps/web/src/components/MemberList.component.tsx` (`MemberListUI`), + a lightweight remove-confirm.
- Edit: `apps/web/src/utils/routes.util.ts` (`SettingsTab.Members` + index), `apps/web/src/routes/settings.tsx` (`validateSearch`), `apps/web/src/views/Settings.view.tsx` (render Members tab/panel gated by `isAdminOrOwner`).
- New tests/stories under `apps/web/src/__tests__/` + `stories/`.

**Steps**

1. **Tests (spec L2 case 4, 7; L3 cases 9–10).** `MemberListUI`: rows; role `Select` only for owner caller + disabled on owner row; Remove disabled for last owner + self. `MembersTabUI`: usage indicator ("used / max" vs "used members"). `routes.util`: `?tab=members` → Members index; unknown → 0. Settings view: Members tab present for owner/admin, **absent** for member. Run; fail.
2. **Implement** the container (wires `useRole`, `sdk.members.list`, `changeRole`/`remove` mutations, `useToast`, `members.root` invalidation) + `MemberListUI` + tab wiring. Green.
3. Lint + type-check.

**Done when:** an owner/admin sees the Members tab with the list + re-role/remove + usage; a member never sees it; L2/L3 member+routing cases pass. (Invite/pending arrive in slice 3.)

**Risk:** two conditional Settings tabs (Members + Activity) — keep the `SETTINGS_TAB_INDEX` order aligned with render order and rely on the existing hidden-tab deep-link bounce (`Settings.view.tsx:114`).

---

## Slice 3 — Invite dialog + Pending-invitations section

The write path: invite (with copyable link) + manage pending invites.

**Files**

- New: `apps/web/src/components/InviteMemberDialog.component.tsx` (`InviteMemberDialogUI`), `apps/web/src/components/PendingInvitationList.component.tsx` (`PendingInvitationListUI`).
- Edit: `MembersTab.component.tsx` — add the invite action + pending section + `invitations` query/mutations (invite/revoke/resend) + `invitations.root`/`members.root` invalidation.
- Tests/stories.

**Steps**

1. **Tests (spec L2 cases 5–6).** `InviteMemberDialogUI`: the full Dialog & Form Test Checklist (open/closed, submit/Enter, cancel, loading, FormAlert present/absent, field errors + `aria-invalid` + `required`, rejects `owner`/bad email) + copy-link affordance shows `inviteUrl` on success. `PendingInvitationListUI`: rows + resend/revoke + empty state. Run; fail.
2. **Implement** the dialog (Form & Dialog pattern, `InviteCreateRequestSchema`), the pending list, and the container wiring (invite success surfaces the link; cap-reached disables invite with a reason from the `409`). Green.
3. Lint + type-check.

**Done when:** owner/admin can invite (+ copy link), revoke, resend from the tab; L2 dialog/pending cases pass.

**Risk:** copy-link is available only on invite/resend success (token hashed) — the pending rows resend to mint a new link, they don't display the original.

---

## Slice 4 — Accept landing route + Auth0 `returnTo` wiring

The invitee-facing route and the app-wide login `returnTo` mechanism (D2).

**Files**

- New: `apps/web/src/routes/invitations.accept.tsx` (`validateSearch` → `{token}`, `<Authorized>`), `apps/web/src/views/AcceptInvitation.view.tsx`.
- Edit: `apps/web/src/api/auth.api.ts` (`withGoogle(returnTo?)` → `appState.returnTo`), `apps/web/src/providers/Application.provider.tsx` (`onRedirectCallback` → stash `returnTo`; `usePostLoginReturnTo` bridge navigates once), `apps/web/src/components/Authorized.component.tsx` (login trigger carries current path).
- Tests/stories for `AcceptInvitationView`.

**Steps**

1. **Tests (spec L2 case 8).** `AcceptInvitationView`: pending / success / already-member / `404` / `410` states driven from the accept mutation result (render the pure view with a mocked `sdk.invitations.accept` handle). Run; fail.
2. **Implement** the route + view (accept-on-mount, invalidate `organizations.root`, toast, navigate home on success) + the `appState.returnTo` / `onRedirectCallback` / bridge / `Authorized` trigger. Green.
3. Lint + type-check.

**Done when:** the view renders every state; the route validates `token`; the `returnTo` wiring compiles. The **login round trip** (logged-out invitee → login → back to the accept link with token) is verified in the smoke walk (auth redirect isn't unit-testable here).

**Risk:** the router is created inside the Auth0 provider, so `onRedirectCallback` can't navigate directly — it stashes `returnTo` (sessionStorage) and the bridge effect navigates once. Guard against a redirect loop (clear the key after consuming).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | `seatUsage` on `GET /members` + contract + swagger + SDK/keys | L1 1–3 | api integration + core unit |
| 2 | Members tab + list + re-role/remove + usage + tab gating | L2 4,7; L3 9–10 | web unit |
| 3 | Invite dialog + pending section (revoke/resend/copy-link) | L2 5–6 | web unit |
| 4 | Accept route + view + Auth0 `returnTo` wiring | L2 8 | web unit (+ smoke) |

Total ≈ **10+ cases**. No migration (no schema change). Commits on `feat/members-ui` → PR #603.

## Cross-slice notes

- **Cross-package CI:** the Unit Tests job runs api + core + web + devops via turbo. A shared-contract change (slice 1's `MemberListResponse`) can break a sibling fixture — run **all** affected packages' suites, not just the one you edited (the #584 lesson). Rebuild `@portalai/core` before web/api pick up the contract change.
- **Swagger mirror:** new registered components (`SeatUsage`, updated `MemberListResponse`) must be added to the swagger round-trip test in the same slice (slice 1).
- **View-owned invalidation:** mutations don't self-invalidate — the `MembersTab` container's `onSuccess` invalidates `members.root`/`invitations.root`; accept invalidates `organizations.root`.
- **`returnTo` is unit-untestable** end-to-end — slice 4's auth wiring is proven in the smoke walk (logged-out invitee round trip). Keep the sessionStorage key single-consume to avoid redirect loops.
- **Docs-in-sync:** consider a short Help/FAQ entry for "inviting teammates" (`packages/core/src/content/faq.util.ts`) since this is a new user-facing capability — decide at smoke time; not blocking. No CLAUDE.md convention change.
- **Component File Policy:** every component file is UI + optional container; tests render the pure `…UI` component (no SDK/router mocks), stories likewise.

## Next step

Implement slice 1 first (tests-first), one commit per slice — only after discovery + spec + plan are reviewed and confirmed. Each slice green and independent; server enforcement is already in place from #584, so the UI only adds affordances + the accept/returnTo path.
