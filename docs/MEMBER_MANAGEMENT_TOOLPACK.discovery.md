# Member management toolpack — Discovery

**Issue:** [EnterpriseBT/portal-ai#847](https://github.com/EnterpriseBT/portal-ai/issues/847)

**Why this exists.**
- **The gap.** In a portal, an admin can shape the access model through `rbac_management`: policies, roles, groups and shares. They can't manage the roster itself. The only member tools are `member_list`, `member_set_roles` and `member_set_groups`. Inviting someone, resending or revoking an invitation, removing a member and checking seat usage happen only in Settings → Members. Yet `SeatService` already implements each one, with its own permission check.
- **Why a separate pack.** Almost every `rbac_management` write needs custom-RBAC entitlement, which only enterprise has. Member management works on every tier and is gated by permissions and seat limits. Mixing the two would make the pack's description wrong for half its tools.

This is the pack that lets the assistant run the roster exactly as Settings → Members does, on every tier, refusing the same things for the same reasons.

## The current shape

### `SeatService` (`apps/api/src/services/seat.service.ts`)

| Method | Permission | Refusals | Notes |
|---|---|---|---|
| `invite(caller, {email, role}, audit)` :76 | `member.invite` | 409 `MEMBER_ALREADY_EXISTS` :97, `INVITATION_ALREADY_PENDING` :112, `SEAT_LIMIT_EXCEEDED` :121/:900; 503 `INVITATION_LINK_UNCONFIGURED` | `role` is `OrgRoleSchema` minus `owner` (`invitation.contract.ts:19`, `.strict()`). **Sends no email**: returns `inviteUrl` with a plaintext token |
| `listInvitations(caller)` :160 | `member.invite` | — | pending rows, no token or URL |
| `resend(caller, id, audit)` :334 | `member.invite` | 404 `INVITATION_NOT_FOUND` (`requirePending` :919) | rotates the token, returns a new `inviteUrl` |
| `revoke(caller, id, audit)` :311 | `member.invite` | 404 `INVITATION_NOT_FOUND` | |
| `removeMember(caller, userId, audit)` :500 | `member.remove` | 404 `ORGANIZATION_MEMBER_NOT_FOUND`, 409 `LAST_OWNER_REMOVAL` | also drops the member's grants, policies, groups and roles (:541-575) |
| `seatUsage(caller)` :289 | none (a roster read for every member, #621) | — | `{used, max \| null}`; pending invitations count as used |
| `setMemberRoles` :603 | `member.role.assign` | 403 `MEMBER_ROLE_ASSIGNMENT_RESTRICTED` :699 (owner/admin changes need an owner) | **no custom-RBAC check** |

**Refusals and audit:**
- **Refusal text.** A refusal throws `permissionDenied`, whose message is a phrase from `permission-refusal.ts:28-30`, e.g. "You don't have permission to invite members". That is the #711 convention.
- **Audit context.** Writes take `SeatAuditContext {sourceIp, userAgent}` (:58).
- **Routes to mirror.** They live in `organization.router.ts`: invitations :711/:762/:809/:859, members :900, remove :1027, roles :567.
- **Where the link is shown.** The web shows `inviteUrl` only right after invite or resend (`MembersTab.component.tsx:300,317`). The token is stored hashed (`invitations.api.ts:16`).

### The `rbac_management` member tools
- **The tool classes.** `apps/api/src/tools/rbac/member.tool.ts` holds `MemberListTool` :29 (`SeatService.listMembers`), `MemberSetRolesTool` :49 and `MemberSetGroupsTool` :80. Each is a thin `build(ctx)` wrapper.
- **`runRbac` and `AGENT_AUDIT`** (`rbac-tool.util.ts`).
  - `AGENT_AUDIT = {sourceIp: null, userAgent: "portal-agent"}` :19.
  - `runRbac` :42 re-throws a 403, so the permission gate (`permission-gate.service.ts:347-353`) turns it into `TOOL_PERMISSION_DENIED`.
  - Every other error becomes `{error: message}`, **without its code**.
- **How a definition is shared.**
  - `MEMBER_LIST_TOOL` (`builtin-toolpacks.ts:1242`) is one spec object listed in both `RBAC_MANAGEMENT_PACK` :1445 and `VIEW_MANAGEMENT_PACK` :1730.
  - `attachCapabilities` :2300 memoizes per object, and `tools.service.ts:889-894` builds the tool once when either pack is on.
  - The web collision check keys on the definition (`toolpack-collisions.util.ts:32-55`).
  - `member_set_roles` is still inline at :1446, and is built only for `rbac_management` (`tools.service.ts:875`).

### Pack registration (the #645 `view_management` precedent, `dd07d560`)
- **Core:**
  - in `builtin-toolpacks.ts`: `BuiltinToolpackSlugSchema` :33, the pack spec, `CAPABILITIES` :1907 (`rbacRead()`/`rbacWrite()`: `writes: []`, `free`, `scalar`), and `BUILTIN_TOOLPACKS` :2321;
  - `tool-phase-labels.ts` :91-112;
  - `tier-catalog.ts` (standard :131, :170; pro and enterprise take every slug);
  - `station-data-packs.ts:18`, which is exhaustive;
  - `ALWAYS_ENTITLED_PACKS = ["help"]` (`tool-capabilities.ts:68`).
- **API:** `tools.service.ts` (`BUILTIN_TOOL_NAMES` :221, the pack blocks in `buildAnalyticsTools` :850-907), `system.prompt.ts`, `swagger.config.ts`.
- **Web:** `tool-pack-icons.util.ts:51`.
- **No migration:**
  - `station_toolpacks.builtin_slug` is text (`station-toolpacks.table.ts:26`).
  - `tiers.builtin_toolpacks` is jsonb (`tiers.table.ts:57`), so a slug reaches a tier row only through `portalops tier apply`. Until then `SeedService.findUnlistedRegistrySlugs` (`seed.service.ts:426`) warns, and the pack stays invisible (it fails closed).

### Gates
- **Wrap order** (`tools.service.ts:1031-1112`): cost gate (`cost-gate.service.ts:327`), then lock gate, then permission gate, then input-character gate, then the output cap.
- **No `TOOL_AUTHORIZATION` entries.** `TOOL_AUTHORIZATION` (`builtin-toolpacks.ts:2157`) covers data-plane writes only, and a guard (`tools.service.test.ts:1332`) fails a `writes: []` tool that has an entry. Control-plane tools like these get none, and the lock gate passes them through (`lock-gate.service.test.ts:289`).
- **Guards that enumerate packs** in `tools.service.test.ts`: cost gate :1042, NUL input :1129, built names and descriptors :1805, one tool per pack :2189. The first three list packs explicitly and leave out the RBAC and view packs, so the new pack has to be added by hand.

### Provisioning and copy
- **The Administrate station.** `PROVISIONED_STATIONS` (`provisioned-stations.constants.ts:27`) gives Administrate `builtinSlugs: ["rbac_management", "help"]`, with an inline description at :30. `provisionOrganizationWorkspace` (`application.service.ts:897`) uses it, and so does reset (`reset.service.ts:294`).
- **Tests:** `provisioned-stations.constants.test.ts`, `application.provision.test.ts`, and the provisioned-stations / reset / ensure-provisioned integration tests.
- **Copy naming Administrate or the pack list:**
  - glossary "Tool Pack" (`glossary.util.ts:293-296`) and :247;
  - FAQ "What are tool packs?" (`faq.util.ts:278-282`) and :72/:85;
  - `system.prompt.ts:939`;
  - the rbac section's member notes (`system.prompt.ts:640-680`).

## The design space

### Decision 1 — How "every tier" is expressed

- **A. List the slug in each tier in `tier-catalog.ts`.** This follows #645. It needs `portalops tier apply` per env, and custom tiers miss it.
- **B. Add it to `ALWAYS_ENTITLED_PACKS`.** This follows #1050 (help). `TierService`, `SiteConfigService` and `SeedService` union it in, so every tier, custom ones included, gets it with no ops step. The constraint is that every tool must be `free`; these all are.

| | A | B |
|---|---|---|
| Custom tiers | missed until edited | included |
| Ops step per env | `tier apply` | none |
| Matches "RBAC decides, not plan" | partly | yes |

**Decided: B** (confirmed). The PRD says access is decided by RBAC, not by plan, which is what `ALWAYS_ENTITLED_PACKS` means, and every tool is free.

### Decision 2 — Whether the invite link reaches the model

`invite` and `resend` return `inviteUrl`, whose token is a bearer credential: anyone holding the link joins the org with that role. The tool result goes to the model provider and is stored in `portal_messages` for replay, where the database otherwise keeps only the token's hash.

- **A. Return it in the tool result.** This is the most useful option: the agent can hand over the link. But it puts a live credential into the transcript and the model's context, which Settings deliberately never stores.
- **B. Leave it out.** The result says the invitation was created and points to Settings → Members, where Resend shows a fresh link. This is safe, but the agent can't complete an invite end to end. Since no email is sent, the invitee gets nothing until someone opens Settings.
- **C. A server-built `invitation` block with a "Get invite link" button** (confirmed). The tool result, and the block built from it, carry only `{invitationId, email, role, expiresAt}`: no token and no URL.
  - **The button** calls the same `sdk.invitations.resend()` that Settings → Members uses (`MembersTab.component.tsx:308-319`). That rotates the token, extends the expiry, and returns a fresh `inviteUrl`.
  - **Where the link lives.** The block shows the link in component state only: the same "copy and share it now" panel Settings shows, extracted from `MembersTab.component.tsx:124-148` into its own component so both places render one panel. Reloading the portal shows the block again without a link, and the button makes a new one.
  - **What this keeps out.** The link never reaches the model, `portal_messages` or the agent's transcript, and the user stays in the portal.

| | A | B | C |
|---|---|---|---|
| Token in the model context | yes | no | no |
| Token at rest in `portal_messages` | yes | no | no |
| Invite usable from the portal | yes | no | yes |
| New surface | none | none | an `invitation` block and its renderer, reusing the resend plumbing and the link panel |

**Decided: C** (confirmed). A link is meant to be shown once and copied, which is what the Settings flow already does. The block brings that flow into the portal without anything storing the link.

### Decision 3 — Sharing `member_set_roles`

- **A. Pull it out as a shared spec `MEMBER_SET_ROLES_TOOL`, like `MEMBER_LIST_TOOL`.** Build it when either pack is on.
- **B. Give each pack its own copy.** Two definitions would collide in the web collision check, and the agent would see two tools.

**Lean: A.** The acceptance criterion asks for a single `member_set_roles`, and that's the existing pattern.

### Decision 4 — Refusals the agent can tell apart

`runRbac` keeps 403s typed, but turns a 409 or 404 into a bare `{error: message}`. The message is the same text Settings shows, which satisfies the acceptance criteria. Without the code, though, the agent can't tell "already pending" (resend instead) from "seat limit" (stop).

- **A. Keep `{error: message}`.**
- **B. Return `{error: message, code}`** from `runRbac`, for every RBAC and member tool.

**Decided: B** (confirmed). The prompt's "show the pending invitation rather than invite again" guidance relies on the agent recognizing `INVITATION_ALREADY_PENDING`. It's a one-line change with no behavior change for the RBAC tools.

## Tradeoff comparison

| | D1 always-entitled | D2 `invitation` block | D3 shared spec | D4 code in errors |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| New contract | no | `help`-style block type + `resultKind` | no | error shape (additive) |
| Ops step | none | none | none | none |

## Recommendation

1. **Register `member_management` ("Members")** in core: the slug, a `MEMBER_MANAGEMENT_PACK` spec, capabilities (`rbacRead`/`rbacWrite`: free, no writes), phase labels, `station-data-packs` (false), an icon, and `ALWAYS_ENTITLED_PACKS`.
2. **Tools** in a new `apps/api/src/tools/rbac/invitation.tool.ts`, plus additions to `member.tool.ts`:
   - `member_invite {email, role: "admin" | "member"}` → `SeatService.invite`;
   - `invitation_list` → `listInvitations`;
   - `invitation_show {invitationId}` → the pending invitation's block (a read; see Open question 1), and `invitation_revoke {invitationId}` → `revoke`;
   - `member_remove {userId}` → `removeMember`;
   - `seat_usage` → `seatUsage`.

   Each goes through `runRbac` with `AGENT_AUDIT`, and the input schemas reuse the core contracts.
3. **An `invitation` block; no link in any result.**
   - **What the tools return.** `member_invite` and `invitation_show` return `{type: "invitation", invitationId, email, role, expiresAt}`, with `resultKind: "invitation"`.
   - **Server-built.** `resolveDisplayBlock` builds the block from the tool's own output, and custom tools can't declare the kind (the #1049 `help` pattern). The block isn't pinnable.
   - **The renderer**, `InvitationBlock`, shows the email, role and expiry and a "Get invite link" button gated on `member.invite`. The button calls `sdk.invitations.resend()` with `invalidate: [queryKeys.invitations.root]`, and shows the returned link in the shared panel, from local state only.
   - **A refused click** (revoked, accepted, or no longer permitted) shows a toast through `serverErrorMessage`.
4. **Shared specs:** `MEMBER_SET_ROLES_TOOL` becomes a shared spec, and `member_list` and `member_set_roles` are built when `rbac_management` or `member_management` is on.
5. **Refusal codes:** `runRbac` returns `{error, code}` for typed `ApiError`s other than 403.
6. **Administrate:** gains `member_management`, with the description "Manage members and access through the assistant: invitations, members, roles, policies, groups and shares. No data is attached here." This applies to new and reset orgs only.
7. **Prompt:** a `member_management` pack section covering:
   - resolve a person with `member_list` before acting;
   - `invitation_show` (whose block offers a fresh link) rather than a second invite when one is pending;
   - the invite link comes only from the block's button: never ask for, guess or paste a link;
   - a refusal names the missing permission.

   The rbac section's member wording becomes pack-neutral.
8. **Help copy:** glossary "Tool Pack", the FAQ on tool packs, and the Administrate mentions (glossary :247, FAQ :72/:85) list the Members pack.
9. **Guard tests:** the explicit pack lists (cost :1042, NUL :1129, names :1805) add `member_management`. Schema parity covers the mirrors.

## Open questions

1. **What happens to the PRD's `invitation_resend` tool?** With the button, a server-side resend from the agent would rotate the token and show no link: the old link dies and the user still has to click.
   - **Lean:** replace it with `invitation_show {invitationId}`, which returns a pending invitation's block, including after a reload or for an invitation made in Settings. The user's click does the resend.
   - The prompt then says "to reshare a pending invitation, show it with `invitation_show`; don't invite again".
   - The PRD deliverable is amended to match.
2. **Should `seat_usage` need any permission?** `SeatService.seatUsage` has none, matching the members list, which every member reads. Lean: none, mirroring Settings → Members.
3. **Should `invitation_list` be in a pack a member-only station would attach?** It needs `member.invite`, so a member gets a typed refusal. Lean: yes. The pack is per station, and the gate is RBAC.
4. **Should `member_remove` be able to remove the caller?** `removeMember` allows it, short of the last owner. Lean: allow it, exactly as Settings does. The PRD forbids new gates beyond the service's.
5. **Does the refusal phrase "name the permission"?** "You don't have permission to invite members" names it in words, not as `member.invite`. Lean: keep the shared #711 phrase, so the tool reads like the UI.

## Enterprise-scale considerations

- **Concurrency & correctness.** The seat-limit check and pending-invite uniqueness live in `SeatService`, including its fail-closed path at :900. The tools add no check-then-act of their own. Lean: inherit, with no new locking.
- **Accuracy & auditability.** Writes use `AGENT_AUDIT` (`userAgent: "portal-agent"`), the same audit trail as the Settings routes, with the agent marked as the source. Lean: inherit.
- **Failure modes.** Every gate fails closed:
  - a permission refusal is a typed result;
  - `INVITATION_LINK_UNCONFIGURED` fails before writing;
  - the cost gate never charges `free` tools.
- **Scale & unbounded growth.** `member_list` and `invitation_list` are org-bounded rosters, already unpaged in Settings. Lean: N/A for now; the output cap bounds results.
- **Multi-tenancy.** Each call runs on the session's `PermissionContext`, whose `organizationId` is the caller's. `requirePending` 404s another org's invitation. Lean: inherit, plus an integration probe for a cross-org invitation id.
- **Contract stability.**
  - Always-entitled means a future plan gate would mean moving the slug out of the always-entitled list.
  - The `{error, code}` shape is additive.
- **Data lifecycle.** Invitation expiry and retention are `SeatService`'s. The link exists only in the browser that generated it, so join credentials never land in stored transcripts or the model provider.

## What this doesn't decide

- **Emailing invitations.** No email is sent today, and the block's link panel stays the only delivery.
- **Group membership tools.** They stay in `rbac_management` under custom-RBAC entitlement (PRD out of scope).
- **Any change to `SeatService` or Settings → Members** (PRD out of scope).
- **Backfilling existing Administrate stations** (the PRD scopes this to new and reset orgs).

## Next step

`docs/MEMBER_MANAGEMENT_TOOLPACK.spec.md` pins the tool input and output schemas, the pack spec, the prompt section and the copy changes. `.plan.md` slices it roughly as follows:
1. Core registration (slug, spec, capabilities, always-entitled) with registry tests.
2. The API tools and the build wiring, including the shared `member_set_roles` and the `runRbac` code, with tool and guard tests.
3. The `invitation` block: core contract and `resultKind`, the server-built block, the web renderer, and the extracted link panel reused by Settings.
4. The prompt and help copy.
5. Provisioning Administrate.
