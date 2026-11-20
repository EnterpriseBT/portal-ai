# Member management toolpack — Plan

**This implements the `member_management` pack, the server-built `invitation` block with its invite-link dialog, and Administrate's attachment, in four TDD slices.**

Spec: `docs/MEMBER_MANAGEMENT_TOOLPACK.spec.md`. Discovery: `docs/MEMBER_MANAGEMENT_TOOLPACK.discovery.md`. Issue: #847. It builds on the shipped #629 (`rbac_management`), #645 (`view_management`), #1044 (Help on the provisioned stations) and #1049 (the `help` block pattern).

The four slices land as **commits on `feat/847-member-management-toolpack`**. Each sits behind a green test suite and leaves the repo compilable.

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd apps/web && npm run test:unit
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run them focused.
4. Run `npm run lint && npm run type-check` (plus `npm run build --workspace @portalai/core` before the api/web runs) at the boundary.

**Sequencing rationale:**
- **Slice 1** lands the leaf pieces nothing else references yet: the `invitation` contract and result kind, `runRbac`'s code and `getPendingInvitation`.
- **Slice 2** is the pack itself. Adding the slug is one indivisible step: `PACK_ELSEWHERE`, `PACK_PROMPT_SECTIONS` and `PACK_USES_STATION_DATA` are exhaustive `Record<BuiltinToolpackSlug, …>`s, and the schema-parity test pairs every mirror with a tool class. So registration, tools, wiring and the prompt section compile together.
- **Slice 3** is web only. The server already sends `invitation` blocks after slice 2, so slice 3 is where they render.
- **Slice 4** is the copy and provisioning, which name the pack and only make sense once it exists.

---

## Slice 1 — The `invitation` block contract and the API leaves

This slice adds the block's contract and how the server builds it, plus the two small API changes the tools need. Nothing produces an `invitation` result yet.

**Files**

- New: `packages/core/src/contracts/invitation-block.contract.ts`. It holds `InvitationBlockContentSchema` (`.strict()`) and `toInvitationBlockContent`, exported from `contracts/index.ts`.
- Edit: `packages/core/src/models/tool-capability.model.ts`. `ResultKindSchema` gets `"invitation"`, the value-production refinement allows it, and `customToolCapabilityError` refuses it.
- Edit: `packages/core/src/contracts/portal.contract.ts`. `PortalBlockTypeSchema` gets `"invitation"`, and it is not pinnable.
- Edit: `apps/api/src/tools/rbac/rbac-tool.util.ts`. `runRbac` returns `{error, code}` for a non-403 `ApiError`.
- Edit: `apps/api/src/services/seat.service.ts`. Adds `getPendingInvitation(caller, id)`.

**Steps**

1. **Write the failing tests (spec cases).**
   - **Core:** `invitation-block.contract.test.ts` (4), `tool-capability.model.test.ts` (2), `portal.contract.test.ts` (1).
   - **API:** `rbac-tools.test.ts`, the `runRbac` code cases (2 of its 4); `seat.service.integration.test.ts`, the `getPendingInvitation` cases (3).

   Run them and see them fail.
2. **Implement** the contract, schema edits, branch, `runRbac` change and service read, until they're green.
3. Lint and type-check core and api.

**Done when:** 12 cases pass, and no tool returns `resultKind: "invitation"` yet.

**Risk:** the `{error, code}` shape reaches every existing RBAC tool. Their tests assert `error` and so stay green, and `code` is additive.

---

## Slice 2 — The `member_management` pack

This slice registers the pack across core, api and web. It adds the six tools and the shared `member_list`/`member_set_roles` wiring, the `## Members` prompt section, and always-entitled access.

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts`:
  - the slug;
  - `MEMBER_SET_ROLES_TOOL` lifted from `RBAC_MANAGEMENT_PACK`;
  - `MEMBER_MANAGEMENT_PACK`;
  - `CAPABILITIES`;
  - `BUILTIN_TOOLPACKS`.
- Edit: `packages/core/src/registries/{tool-capabilities,tool-phase-labels,station-data-packs}.ts`. These hold `ALWAYS_ENTITLED_PACKS`, the six phase labels, and `member_management: false`.
- New: `apps/api/src/tools/rbac/invitation.tool.ts`. It holds `MemberInviteTool`, `InvitationListTool`, `InvitationShowTool` and `InvitationRevokeTool`.
- Edit: `apps/api/src/tools/rbac/member.tool.ts`. Adds `MemberRemoveTool` and `SeatUsageTool`.
- Edit: `apps/api/src/services/portal.service.ts`. `resolveDisplayBlock` gets the `invitation` branch. It looks the result kind up by tool name, so it needs `member_invite` registered (moved here from slice 1).
- Edit: `apps/api/src/services/tools.service.ts`. Covers `BUILTIN_TOOL_NAMES`, the `member_list` and `member_set_roles` build conditions, and the `member_management` block.
- Edit: `apps/api/src/prompts/system.prompt.ts`:
  - `PACK_ELSEWHERE.member_management`, and the rbac entry without "member assignments";
  - `PACK_PROMPT_SECTIONS.member_management` (`## Members`);
  - pack-neutral member wording in the rbac section.
- Edit: `apps/web/src/utils/tool-pack-icons.util.ts` (`GroupAdd`).
- New: `apps/api/src/__tests__/__integration__/tools/member-tools.integration.test.ts`.

**Steps**

1. **Write the failing tests (spec cases).**
   - **Core:** `builtin-toolpacks.test.ts` (4) and `tool-capabilities.test.ts` (2).
   - **API unit:**
     - `invitation-tools.test.ts` (8);
     - `rbac-tools.test.ts`, the `member_remove`/`seat_usage` cases (2);
     - `tools.service.test.ts` (4), adding `member_management` to the explicit pack lists in the cost (:1042), NUL (:1129) and descriptor (:1805) guards;
     - `system.prompt.test.ts` (4);
     - `portal.service.test.ts`, the `resolveDisplayBlock → invitation` cases (3).
   - **API integration:** `member-tools.integration.test.ts` (7).
   - **Web:** `ToolPackIconUtil.test.ts` (1).

   Run them and see them fail.
2. **Implement** in this order: core registration, rebuild core, the API tools and wiring, the prompt section, then the icon. Green, including `builtin-toolpack-schema-parity.test.ts` unchanged.
3. Lint and type-check core, api and web.

**Done when:**
- The 35 cases pass.
- A station with only `member_management` builds eight tools.
- `member_invite` returns block content that `resolveDisplayBlock` turns into an `invitation` block.

**Risk:**
- **Moving `member_set_roles` out of the `rbac_management` block.** The test with `rbac_management` and `view_management` together guards that it's still built once.
- **The integration test.** It drives the tool `execute`s against a real DB with the session's `PermissionContext`, so it needs the integration env (`STRIPE_*` exported).

---

## Slice 3 — The invitation block and its link dialog (web)

This slice renders the `invitation` block. "Get invite link" calls the existing resend and opens `InviteLinkDialog`. The link-and-Copy content is extracted from `MembersTab` and shared.

**Files**

- New: `apps/web/src/components/InviteLinkField.component.tsx` (`InviteLinkFieldUI`).
- New: `apps/web/src/components/InviteLinkDialog.component.tsx` (`InviteLinkDialogUI`).
- New: `apps/web/src/components/InvitationBlock.component.tsx` (`InvitationBlockUI` and the `InvitationBlock` container).
- New: `apps/web/src/utils/invitation-block-renderer.util.tsx`, registered in `main.tsx`.
- Edit: `apps/web/src/components/MembersTab.component.tsx`. Its success `Alert` renders `InviteLinkFieldUI`.
- Edit: `apps/web/src/utils/portal-stream.util.ts`. Adds the `invitation` case.
- Edit: `apps/web/src/api/invitations.api.ts`. `resend` gets `onPermissionDenied`.

**Steps**

1. **Write the failing tests (spec cases):**
   - `InviteLinkField.test.tsx` (2)
   - `InviteLinkDialog.test.tsx` (5)
   - `InvitationBlock.test.tsx` (4)
   - `InvitationBlock.container.test.tsx` (3)
   - `portal-stream.util.test.ts` (1)
   - `invitation-block-renderer.util.test.tsx` (1)

   `MembersTab.test.tsx` and `SettingsMembersTab.test.tsx` must stay green. Run them and see them fail.
2. **Implement** the field first, then switch `MembersTab` over to it, then the dialog, block, renderer and stream case. Green.
3. Lint and type-check web. The guard suites must pass:
   - `dialog-contract.guard`: R6, the dialog's own axe test;
   - `component-axe.guard`;
   - `action-gate.guard`: no `disabled` read from a permission;
   - `mutation-toast` / `mutation-invalidate`: the toast and invalidate go through options;
   - `permission-denied-invalidation`.

**Done when:**
- 16 cases pass, plus the unchanged Members tests.
- In a portal, an `invitation` block renders, and its button opens the dialog with a working link.

**Risk:**
- **Extracting the field changes the Members tab's DOM.** Its tests pin the text, the "Invite link" label and Copy.
- **The dialog has no form.** R1 doesn't apply, because it renders no `FormAlert`.

---

## Slice 4 — Help copy and the Administrate station

This slice attaches the pack to Administrate, updates its description, and updates the help copy that lists packs and describes Administrate.

**Files**

- Edit: `apps/api/src/constants/provisioned-stations.constants.ts`. Administrate's `builtinSlugs` and `description`.
- Edit: `packages/core/src/content/glossary.util.ts`. "Tool Pack" lists Members; the Administrate mention (:247) is updated.
- Edit: `packages/core/src/content/faq.util.ts`. "What are tool packs?" and the Administrate mentions (:72, :85).

**Steps**

1. **Write the failing tests (spec cases):**
   - `provisioned-stations.constants.test.ts` and `application.provision.test.ts` (2);
   - `provisioned-stations.integration.test.ts` (1);
   - `glossary.util.test.ts` / `faq.util.test.ts` (2).

   Run them and see them fail.
2. **Implement** the constant and copy edits. Green, including `help-findability.test.ts` (the edited titles still rank first) and the permission-copy guards (the copy names permissions, not roles).
3. Lint and type-check.

**Done when:** the 5 cases pass, and a new org's Administrate has `rbac_management`, `member_management` and `help`.

**Risk:** the Administrate wording sits in three files plus the station constant, so grep "Administrate" before committing.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `invitation` contract and result kind; `runRbac` code; `getPendingInvitation` | 12 cases (core, api) |
| 2 | the pack: registration, 6 tools, shared wiring, the `invitation` display block, `## Members` prompt, icon | 35 cases incl. 7 integration |
| 3 | `InvitationBlock`, `InviteLinkDialog`, `InviteLinkField` (Members tab reuses it) | 16 cases + the web guard suites |
| 4 | Administrate attaches the pack; help copy | 5 cases + findability and permission-copy guards |

That's 68 cases in all, the spec's test plan.

## Cross-slice notes

- **Rebuild core** after slices 1 and 2, and restart the API dev server for a manual check; nodemon watches only `apps/api/src`.
- **No migration, no `tier apply`.** Entitlement is `ALWAYS_ENTITLED_PACKS`. `SeedService.findUnlistedRegistrySlugs` unions it in, so it doesn't warn.
- **Doc sync:**
  - **Tool surfaces:** the `.tool.ts` descriptions, the `builtin-toolpacks.ts` mirror and `system.prompt.ts` all land in slice 2. The parity test holds the schemas.
  - **Help copy:** lands in slice 4.
  - **No egress change:** invitations send no email, so `DEPLOYMENT_SECURITY_REVIEW.md` is unaffected.
  - **The accessibility conformance report:** the new block button and dialog are a new interactive pattern in the portal. Check `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`'s keyboard and focus rows in slice 3; there's likely no change, since the dialog is a standard `Modal`.
- **The token never crosses into agent-visible data.** Slice 1's strict schema and slice 2's integration test (no `inviteUrl` in the result or in `portal_messages`) hold it. Slice 3 keeps the link in component state.

## Next step

Once this plan is confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
