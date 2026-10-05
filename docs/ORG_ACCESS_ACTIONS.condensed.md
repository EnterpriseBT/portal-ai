# Gate organization & access actions — Condensed design (#691)

**Issue:** [EnterpriseBT/portal-ai#691](https://github.com/EnterpriseBT/portal-ai/issues/691) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #684. Audit rows 29–35, 37–38 in `docs/PER_OBJECT_ACTION_AFFORDANCES.discovery.md`. `apps/web` only.

**Why.** The organization and access surfaces are the last ones on raw `disabled` buttons. The action-gate guard's `KNOWN_VIOLATIONS` names exactly these four files, and this ticket empties that list. Beyond that:
- **Toolpacks** ignore their rows' `capabilities`, and **Register** fails *open* on the tier.
- **Remove member** never checks `member.remove`.
- **Billing** and **Delete organization** render dead buttons.
- The **Access tab's** tier lock is plain text with no way to upgrade.
- A **system policy or role** opens as a disabled form.
- **Deleting** a role, policy or group fires instantly, with no confirm and no pending state.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Toolpack row Refresh/Edit/Delete | `views/Toolpacks.view.tsx:208-258` | custom rows only; no gate; the container casts rows to `Toolpack[]`, dropping `capabilities` |
| Rotate secret / Refresh schema | `components/EditToolpackDialog.component.tsx:221-237` | inside the edit dialog (reached only via Edit) |
| Register (tier) | `views/Toolpacks.view.tsx:329-352`, entitlement `:402-404` | literal-disabled button + tooltip; `customToolpacks ?? true` (fails open) |
| Remove member | `components/MemberList.component.tsx:196-213` | disabled for self/last owner with reasons; no `member.remove` check (server: `seat.service.ts:488`) |
| Resend/Revoke invite | `components/PendingInvitationList.component.tsx:67-91` | server needs `member.invite` (`seat.service.ts:303,326`), which already gates the whole tab |
| Invite (seat cap) | `components/MembersTab.component.tsx:115-125, 235-238` | guard-flagged `disabled={!canInvite}`; `canInvite` is really "seat cap not reached" |
| Change plan / Manage subscription | `TierCard.component.tsx:40-50, 213-229`; `SubscriptionBilling.component.tsx:63-77, 201-211` | guard-flagged `disabled={!canManageBilling …}`, with a hand-rolled tooltip helper duplicated in both files |
| Delete organization | `views/Settings.view.tsx:408-416` | guard-flagged `disabled={!canDeleteOrg}` |
| Access tab, not entitled | `views/Settings.view.tsx:459-483` | plain text "…an enterprise feature… Upgrade to author custom access.", with no link |
| System policy/role | `modules/AccessAuthoring/PolicyEditorDialog.component.tsx:54-119`, `RoleEditorDialog.component.tsx:45-103` | `kind === "system"` → disabled TextFields, Close only |
| Delete role/policy/group | `modules/AccessAuthoring/AccessAuthoring.component.tsx:124-134, 237-256` | immediate mutation, toast on error, no pending state (double-click deletes twice) |

## Decisions

1. **Toolpacks follow their rows.**
   - The UI takes the capability-bearing rows (no cast).
   - Edit, Refresh and Rotate gate on `capabilities.write`; Delete on `capabilities.delete`. Builtins are already read-only and keep their no-actions rows.
   - **Register:**
     - `allowed` = `canOnResource("toolpack","write")`;
     - `entitled` = `useActionGate().entitled("customToolpacks")`, which **fails closed** while usage loads (it's an action);
     - so: an `upsell` with "Your plan does not include custom toolpacks", leading to Billing.
   - The "Inactive on your plan" display chip keeps its fail-open read. It's display, not an action, and flipping it would flash "inactive" on every load.
2. **Members.**
   - Remove gates on `can("member.remove")` (hide). The self and last-owner cases stay `disable` with their existing reasons.
   - Resend/Revoke need nothing new: the tab itself requires `member.invite`, which is what they check.
   - Invite at the seat cap becomes an `upsell` with the existing copy ("Seat limit reached (N / M). Remove a member or upgrade to invite more.").
   - The **Groups column stays hidden** without `customRbac`. It's a data column, not an action, and the Access tab (point 5) is the one place to upgrade for custom RBAC.
3. **Billing.** Without `billing.manage`, Change plan and Manage subscription are **hidden**. They're permission-gated, and the audit says hide. One shared helper replaces the duplicated tooltip wrapper.
4. **Delete organization.** Without `org.delete`, the whole danger-zone block is hidden: an orphaned "Only the owner can do this" with no button says nothing useful.
5. **Access tab, not entitled:** the existing copy plus the shared `UpgradeLink` (Settings → Billing).
6. **System policy/role** opens a **read-only view**: values as text (name, description, and statements via `StatementEditorUI readOnly`), with a Close button. No disabled inputs.
7. **Access deletes** get a `DeleteAccessItemDialog`, modelled on `DeleteToolpackDialog`: `Modal` + `FormAlert`, `submitDisabled` while pending, error kept in the dialog. The row's Delete opens it.
8. **Guard.** `KNOWN_VIOLATIONS` becomes empty, and the guard's shrink-only check makes it stay that way.

## Plan — 4 slices (tests first in each; `npm run test:unit` in `apps/web`)

1. **Toolpacks**
   - Files: `views/Toolpacks.view.tsx`, `components/EditToolpackDialog.component.tsx` (a `canWrite` for rotate/refresh, if the dialog can open read-only).
   - Tests: `__tests__/Toolpacks.view.test.tsx` covers:
     - per-row gates;
     - Register `upsell`, plus fail-closed while usage is unknown;
     - the fixtures gain `capabilities`.
2. **Members and billing**
   - Files: `MemberList`, `MembersTab`, `TierCard`, `SubscriptionBilling`, plus a shared billing-gate helper.
   - Tests:
     - `MemberList.test.tsx`: Remove hidden without `member.remove`;
     - `MembersTab.test.tsx`: Invite `upsell` at the cap;
     - `TierCard.component.test.tsx` and `SubscriptionBilling.component.test.tsx`: hidden without `billing.manage`.
   - Three of the four guard entries leave the list.
3. **Settings**
   - Files: `views/Settings.view.tsx`.
   - Tests:
     - `SettingsDangerZone.test.tsx`: no danger zone without `org.delete`;
     - an Access-tab test: the upgrade link when not entitled.
   - The last guard entry leaves the list, so `KNOWN_VIOLATIONS` is now `{}`.
4. **Access authoring**
   - Files: read-only views in `PolicyEditorDialog` and `RoleEditorDialog`; new `components/DeleteAccessItemDialog.component.tsx`; `AccessAuthoring.component.tsx`.
   - Tests:
     - new `PolicyEditorDialog.test.tsx` and `RoleEditorDialog.test.tsx`: a system row renders text, not inputs;
     - new `DeleteAccessItemDialog.test.tsx`: the dialog checklist;
     - `AccessAuthoring.test.tsx`: Delete opens the confirm.

## Smoke (against your dev stack; setup by CLI, walk in the browser)

**Preflight:**
- **Stack:** `npm run dev`. Sessions: `e2e:auth:all`, and switch admin and member into e2e-fixture (`POST /api/organization/switch`).
- **Tiers:** `STRIPE_SECRET_KEY=<test key from apps/api/.env> npx portalops tier apply --env local --yes`. Stripe is read-only, for price lookup.
  - **Prerequisite:** `tier apply` must converge `customRbac` and `maxSeats` (see the bug filed from this design). Until it does, `enterprise` lands without custom RBAC.
- **Org tier:** `npx portalai org set-tier <e2e org id> enterprise --env local --yes`, then wait ≤60s for the tier cache.
- **Fixtures (as owner, via the API):**
  - a custom policy "smoke691 invite-only" (`allow invite member`) on a group "smoke691 inviters" containing the **member**, so the member reaches Members without `member.remove`;
  - a custom toolpack registered by the **owner** (`npm run mock-toolpack-server` or any reachable endpoint).
- **Reset:** delete the group, policy, toolpack and invites; `set-tier … enterprise`.

1. As **admin** on Toolpacks: the owner's custom pack shows no Edit/Refresh/Delete; one the admin registered shows them. Builtins show none.
2. `set-tier … standard` (no `customToolpacks`) and wait for the cache. As **owner**: Register shows a lock, its tooltip reads "Your plan does not include custom toolpacks", and clicking it lands on Settings → Billing.
3. As the **member** (via the invite-only group), Settings → Members: no Remove on any row. As **owner**: Remove shows, with "You can't remove yourself" on their own row.
4. Still on `standard` (5 seats; 3 used): as owner, `POST /api/organization/invitations` twice (`smoke691-a@example.com`, `-b`; no email is sent). Invite then shows the seat-limit reason with an upgrade affordance that lands on Billing. Revoke one, and Invite is enabled again.
5. As **admin** (no `billing.manage`), Settings → Billing: no Change plan or Manage subscription buttons. As **owner**: both are present.
6. As **admin** (no `org.delete`), Settings → Organization: no danger zone. As **owner**: Delete organization shows.
7. Still on `standard` (no `customRbac`): Settings → Access shows the enterprise copy with a "View plans" link that lands on Billing. Then `set-tier … enterprise` back.
8. As **owner** (enterprise), Access: a system policy opens as plain text with only Close. Delete "smoke691 inviters": a confirm dialog appears; confirming deletes it once, and a double-click doesn't double-delete.

## Out of scope

- Server authorization changes; new caller capabilities.
- An upsell for the Members Groups column (Decision 2).
- The member-side 403 on `/api/toolpacks` from station pages (#690's walk). It's a class read the member lacks: a separate question of whether station chips should fetch it.
