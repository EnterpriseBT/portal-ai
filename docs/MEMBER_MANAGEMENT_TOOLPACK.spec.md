# Member management toolpack — Spec

This pins the `member_management` ("Members") built-in pack: its tools, the server-built `invitation` block whose button gets a fresh invite link through the existing resend plumbing, and the Administrate station attaching the pack. Discovery: [`MEMBER_MANAGEMENT_TOOLPACK.discovery.md`](MEMBER_MANAGEMENT_TOOLPACK.discovery.md). Issue: [#847](https://github.com/EnterpriseBT/portal-ai/issues/847).

## Key decisions (flag for review)

1. **Every tier through `ALWAYS_ENTITLED_PACKS`**, like Help (#1050). RBAC decides access, not plan. Every tool is `free`, and no `portalops tier apply` is needed.
2. **No invite link anywhere the agent reaches.**
   - **What the tool returns.** `member_invite` and `invitation_show` return an `invitation` block content: `{invitationId, email, role, status, expiresAt}`. That schema is `.strict()`, so a URL field can't ride along.
   - **Where the link comes from.** The block's "Get invite link" button calls `sdk.invitations.resend()` and opens an **`InviteLinkDialog`**: a `Modal` showing the link and a Copy button, the same content Settings → Members shows after Resend. The link lives in React state only and is cleared when the dialog closes.
3. **`invitation_show` replaces the PRD's `invitation_resend`** (amended in the issue). It's a read; the user's click does the resend.
4. **`member_list` and `member_set_roles` are each one shared spec.** `member_list` is built for `rbac_management`, `view_management` or `member_management`; `member_set_roles` for `rbac_management` or `member_management`.
5. **`runRbac` returns `{error, code}`.** For a non-403 `ApiError`, the agent can then tell `INVITATION_ALREADY_PENDING` from `SEAT_LIMIT_EXCEEDED`. A 403 still re-throws, and the permission gate turns it into `TOOL_PERMISSION_DENIED`, carrying the #711 phrase from `permission-refusal.ts`.
6. **`SeatService` semantics are unchanged.** It gains one read, `getPendingInvitation`, which composes the existing `member.invite` check with `requirePending`.
7. **Administrate attaches the pack** for new and reset orgs only. Existing Administrate stations aren't backfilled.

## Scope

### In scope

- Core:
  - the slug, pack spec, capabilities, phase labels and always-entitled entry;
  - the `invitation` result kind and block type, and its contract;
  - the help copy.
- API:
  - the six new tools, plus the shared `member_list`/`member_set_roles` wiring;
  - the `runRbac` code and `getPendingInvitation`;
  - the display block in `resolveDisplayBlock`;
  - the prompt section and provisioning.
- Web:
  - the `invitation` block renderer and its container;
  - `InviteLinkFieldUI`, the link-and-Copy content extracted from `MembersTab`, used by its banner and by the new `InviteLinkDialog`;
  - the stream mapping and the pack icon.

### Out of scope

- Group membership tools: they stay in `rbac_management`.
- Emailing invitations.
- Accepting invitations through the agent.
- Backfilling existing Administrate stations.
- Any change to the Settings → Members behavior. Its banner keeps its layout and renders the extracted `InviteLinkFieldUI`, with identical output.

## Surface

### Core — `packages/core/src/registries/builtin-toolpacks.ts`

- **The slug.** `BuiltinToolpackSlugSchema` adds `"member_management"`.
- **`MEMBER_SET_ROLES_TOOL: ToolpackToolSpec`** lifts today's inline `member_set_roles` spec (:1446) unchanged. `RBAC_MANAGEMENT_PACK` lists it by reference.
- **`MEMBER_MANAGEMENT_PACK: BuiltinToolpackSpec`:**
  - **identity:** `slug: "member_management"`, `name: "Members"`, `iconSlug: "GroupAdd"`;
  - **description:** "Manage the organization's members in a session: invite people, show, list and revoke pending invitations, remove members, set members' roles, and check seat usage. Available on every plan; each action needs its permission (`member.invite`, `member.remove`, `member.role.assign`)."
  - **tools, in order:** `MEMBER_LIST_TOOL`, `MEMBER_SET_ROLES_TOOL`, then:

| Tool | `parameterSchema` (required) | Description (agent-facing) |
|---|---|---|
| `member_invite` | `email` (string), `role` (`"admin"`\|`"member"`) — both required | Invites someone by email with a system role. The user sees the invitation as a block with a button that generates the link to share; the result never contains a link. Refuses an existing member, an already-pending invitation (show it with `invitation_show` instead) and a full seat count. Needs `member.invite`. |
| `invitation_list` | none | Lists pending invitations: id, email, role and expiry. Needs `member.invite`. |
| `invitation_show` | `invitationId` (required) | Shows a pending invitation to the user as a block whose button generates a fresh link (which replaces the old one). Use it to reshare an invitation instead of inviting again. Needs `member.invite`. |
| `invitation_revoke` | `invitationId` (required) | Revokes a pending invitation so its link stops working. Needs `member.invite`. |
| `member_remove` | `userId` (required) | Removes a member from the organization, with their roles, groups and grants. The last owner can't be removed. Resolve the person with `member_list` first. Needs `member.remove`. |
| `seat_usage` | none | Returns `{used, max}` seats: members plus pending invitations, against the plan's limit (`max` null means unlimited). |

- **`CAPABILITIES`:**
  - `member_invite`: `{...rbacWrite(), resultKind: "invitation"}`.
  - `invitation_show`: `{...rbacRead(), resultKind: "invitation"}`.
  - `invitation_list` and `seat_usage`: `rbacRead()`.
  - `invitation_revoke` and `member_remove`: `rbacWrite()`.
- **`BUILTIN_TOOLPACKS`** gains `MEMBER_MANAGEMENT_PACK`.

### Core — other registries and models

- **`tool-capabilities.ts`:** `ALWAYS_ENTITLED_PACKS = ["help", "member_management"]`.
- **`tool-phase-labels.ts`:**
  - `member_invite`: "Inviting a member"
  - `invitation_list`: "Listing invitations"
  - `invitation_show`: "Showing the invitation"
  - `invitation_revoke`: "Revoking the invitation"
  - `member_remove`: "Removing the member"
  - `seat_usage`: "Checking seats"
- **`station-data-packs.ts`:** `member_management: false`.
- **`models/tool-capability.model.ts`:**
  - `ResultKindSchema` adds `"invitation"`.
  - The `production.kind "value"` refinement allows it (alongside `scalar`/`mutation-result`/`progress`/`help`).
  - `customToolCapabilityError` refuses it: "custom tools cannot declare resultKind 'invitation' (only the built-in member tools show invitations)".
- **`contracts/portal.contract.ts`:** `PortalBlockTypeSchema` adds `"invitation"`, which is **not** in `PINNABLE_BLOCK_TYPES`.
- **New `contracts/invitation-block.contract.ts`** (exported from `contracts/index.ts`):

```ts
export const InvitationBlockContentSchema = z
  .object({
    type: z.literal("invitation"),
    invitationId: z.string().min(1),
    email: z.string(),
    role: OrgRoleSchema,
    status: InvitationStatusSchema,
    expiresAt: z.number(),
  })
  .strict(); // no inviteUrl, token or tokenHash can pass
export type InvitationBlockContent = z.infer<typeof InvitationBlockContentSchema>;
export function toInvitationBlockContent(inv: InvitationResponse): InvitationBlockContent;
```

`toInvitationBlockContent` picks the five fields and drops `inviteUrl`.

### Core — help content

- **Glossary "Tool Pack"** (`glossary.util.ts:293-296`) and **FAQ "What are tool packs?"** (`faq.util.ts:278-282`) list "Members".
- **The Administrate mentions** (glossary :247, FAQ :72/:85) say it manages members as well as access.

### API — `apps/api/src/tools/rbac/rbac-tool.util.ts`

```ts
export async function runRbac<T>(
  fn: () => Promise<T>
): Promise<T | { error: string; code?: string }>;
```

- A 403 `ApiError` still re-throws.
- Any other `ApiError` returns `{error: err.message, code: err.code}`.
- A non-`ApiError` returns `{error}` with no code.
- A 503 `INVITATION_LINK_UNCONFIGURED` is relayed the same way.

### API — `SeatService.getPendingInvitation`

```ts
static async getPendingInvitation(
  caller: PermissionContext,
  invitationId: string
): Promise<InvitationResponse>; // checks member.invite, then requirePending → 404 INVITATION_NOT_FOUND
```

### API — tools (`apps/api/src/tools/rbac/`)

Each tool `extends Tool`, has `build(ctx: PermissionContext)`, and runs through `runRbac` with `AGENT_AUDIT` on writes.

- **New `invitation.tool.ts`:**
  - **`MemberInviteTool`.** Input `{email: z.string().email(), role: OrgRoleSchema.exclude(["owner"])}`. Calls `SeatService.invite(ctx, input, AGENT_AUDIT)` and returns `toInvitationBlockContent(inv)`.
  - **`InvitationListTool`.** Returns `{invitations: [{invitationId, email, role, expiresAt}]}`.
  - **`InvitationShowTool`.** Input `{invitationId: z.string().min(1)}`. Returns `toInvitationBlockContent(await SeatService.getPendingInvitation(...))`.
  - **`InvitationRevokeTool`.** Returns `{success: true, invitationId, status: "revoked"}`.
- **`member.tool.ts`** gains:
  - **`MemberRemoveTool`.** Input `{userId}`. Returns `{success: true, userId}`.
  - **`SeatUsageTool`.** Returns `SeatService.seatUsage(ctx)`.

### API — `services/tools.service.ts`

- **`BUILTIN_TOOL_NAMES`** adds the six new names.
- **`buildAnalyticsTools`:**
  - `member_list` is built when any of `rbac_management`, `view_management` or `member_management` is enabled.
  - `member_set_roles` moves out of the `rbac_management` block and is built when `rbac_management` or `member_management` is enabled.
  - A `member_management` block builds the six new tools.
- **Gate order is unchanged:** cost, lock, permission, input-character, output cap.
- **No `TOOL_AUTHORIZATION` entries** (`writes: []`).

### API — `services/portal.service.ts` → `resolveDisplayBlock`

```ts
if (resultKind === "invitation") {
  const parsed = InvitationBlockContentSchema.safeParse(toolResult);
  if (!parsed.success) return null; // e.g. a runRbac {error, code} result
  return { block: { type: "invitation", content: parsed.data }, sseResult: parsed.data };
}
```

### API — `prompts/system.prompt.ts`

- **`PACK_ELSEWHERE.member_management`:** "inviting and removing members, invitations and seat usage".
- **`rbac_management`'s entry** drops "member assignments" and keeps roles, policies, groups and sharing.
- **`PACK_PROMPT_SECTIONS.member_management`:**
  - `capability: "manage the organization's members and invitations"`
  - `requestShapes: ["invite someone", "remove a member"]`
  - `blocks: ["invitations"]`
  - `interpretiveTools: []`
  - `markers: ["manage the organization's members and invitations", "## Members", "member_invite"]`
- **`render()`** emits `## Members` with these rules:
  1. Resolve a person to a `userId` with `member_list` before removing them or setting their roles. Never invent an id.
  2. `member_invite` and `invitation_show` show an invitation block. The user gets the link from its button, and you never write, ask for or guess a link. Don't restate the block.
  3. On `INVITATION_ALREADY_PENDING`, show the existing invitation with `invitation_show` (its id is from `invitation_list`) instead of inviting again. On `SEAT_LIMIT_EXCEEDED`, say the seats are full and point to Settings → Billing, quoting `seat_usage`.
  4. A refusal names the permission it needs. Relay it as is.
- **The rbac section's member wording** (:645, :668-671) becomes pack-neutral (it holds when `member_set_roles` comes from either pack).

### API — `constants/provisioned-stations.constants.ts`

The Administrate entry:
- `builtinSlugs: ["rbac_management", "member_management", "help"]`;
- `description`: "Manage members and access through the assistant: invitations, members and shares on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here. You can also ask how Portals works."

### Web

- **New `components/InviteLinkField.component.tsx`:** `InviteLinkFieldUI {url, onCopy}`.
  - It is the content of today's `MembersTab.component.tsx:126-146`: the "copy and share it now" text, a read-only `TextField` labelled "Invite link", and a Copy button.
  - `MembersTab`'s success `Alert` renders it, with the same output as today.
- **New `components/InviteLinkDialog.component.tsx`:** `InviteLinkDialogUI {open, email, url, onCopy, onClose}`.
  - It is a core `Modal` titled "Invite link for <email>", with `InviteLinkFieldUI` as its content and a single "Done" action (`type="button"`) that calls `onClose`.
  - It isn't a form (it submits nothing), so it takes no `onSubmit`, `FormAlert` or `pending`.
  - Focus goes to Copy on open (`useDialogAutoFocus(open)`).
  - Escape, the backdrop, the close button and Done all close it.
- **New `components/InvitationBlock.component.tsx`:**
  - **`InvitationBlockUI`.** Props: `{content, getLinkGate: ActionGate, onGetLink}`.
    - It renders an outlined `section`, `aria-label="Invitation: <email>"`, with the email, a role chip, and "Expires <date>".
    - Below that is `GatedButton` "Get invite link" (`gate={getLinkGate}`). The block itself never shows a link.
  - **`InvitationBlock` (container).**
    - **Gate.** `useCapabilities().can("member.invite")` drives `decideActionGate({allowed})`: not permitted means `hide`. While the resend is pending, it's `pendingGate`.
    - **Request.** `sdk.invitations.resend().mutate({id}, {invalidate: [queryKeys.invitations.root], toast: {error: "Couldn't generate a link"}, onSuccess: u => setUrl(u.inviteUrl ?? null)})`.
    - **Dialog.** It renders `InviteLinkDialogUI` open while `url` is set. Closing sets `url` to null, so the link is gone from the page.
    - **Copy** works as `MembersTab.handleCopyLink` does: clipboard plus a toast.
- **New `utils/invitation-block-renderer.util.tsx`:** `registerInvitationBlockRenderer()` registers `"invitation"` and renders null for an invalid content. It is registered in `main.tsx`.
- **`utils/portal-stream.util.ts`:** `type === "invitation"` maps to `{type: "invitation", content: result}`.
- **`utils/tool-pack-icons.util.ts`** maps `GroupAdd`.
- **`api/invitations.api.ts`:** `resend` declares `onPermissionDenied: { invalidate: () => [queryKeys.invitations.root] }`.

## Migration

None.
- `station_toolpacks.builtin_slug` is text, and `tiers.builtin_toolpacks` is jsonb.
- Entitlement comes from `ALWAYS_ENTITLED_PACKS`, not tier rows.

## Seed

None. The Administrate change applies through `provisionOrganizationWorkspace` at create and reset.

## TDD test plan

Run per package with `npm run test:unit` / `npm run test:integration`.

### Core

These cases live in `packages/core/src/__tests__/`.
- **`registries/builtin-toolpacks.test.ts`:**
  - the pack exists, with eight tools in order;
  - `member_list` and `member_set_roles` are the same objects as in `RBAC_MANAGEMENT_PACK`;
  - every tool's capability is `free`;
  - `member_invite`/`invitation_show` are `resultKind: "invitation"`.

  4 cases.
- **`registries/tool-capabilities.test.ts`:** `member_management` is always entitled, and the "always-entitled tools are free" guard holds. 2 cases.
- **`models/tool-capability.model.test.ts`:** the `invitation` kind is valid with value production, and custom tools are refused it. 2 cases.
- **`contracts/invitation-block.contract.test.ts`:**
  - it parses a valid content;
  - `.strict()` rejects `inviteUrl` and `tokenHash`;
  - `owner` is a valid role but a bad status is refused;
  - `toInvitationBlockContent` drops `inviteUrl`.

  4 cases.
- **`contracts/portal.contract.test.ts`:** `invitation` is a block type and not pinnable. 1 case.
- **`content/glossary.util.test.ts` / `faq.util.test.ts`:** the "Members" pack is listed. 2 cases.

### API

These cases live in `apps/api/src/__tests__/`.
- **`tools/rbac/invitation-tools.test.ts`** (new):
  - invite returns block content with no `inviteUrl`, and passes `AGENT_AUDIT`;
  - a 409 is relayed as `{error, code: "INVITATION_ALREADY_PENDING"}`;
  - a 403 is re-thrown;
  - list maps fields;
  - show returns the block, and a 404 is `{error, code: "INVITATION_NOT_FOUND"}`;
  - revoke returns success;
  - an `owner` role is rejected by the input schema.

  8 cases.
- **`tools/rbac/rbac-tools.test.ts`:**
  - `member_remove` calls `removeMember` with `AGENT_AUDIT`, and `LAST_OWNER_REMOVAL` is relayed with its code;
  - `seat_usage` returns `{used, max}`;
  - `runRbac` adds `code` for `ApiError`s and leaves other errors bare.

  4 cases.
- **`services/seat.service.test.ts`:** `getPendingInvitation` checks `member.invite`, 404s a revoked or other-org id, and returns the row without a token. 3 cases.
- **`services/tools.service.test.ts`:**
  - `member_management` alone builds `member_list`, `member_set_roles` and the six tools;
  - with `rbac_management` or `view_management` too, `member_list`/`member_set_roles` are built once;
  - the cost, NUL-input and descriptor guards list the pack;
  - the new names are in `BUILTIN_TOOL_NAMES`.

  4 cases.
- **`tools/builtin-toolpack-schema-parity.test.ts`:** covers the new mirrors automatically. 0 new cases.
- **`services/portal.service.test.ts`:** `resolveDisplayBlock` builds an `invitation` block, returns null for `{error, code}`, and never passes an `inviteUrl` through. 3 cases.
- **`prompts/system.prompt.test.ts`:**
  - the `## Members` section renders only with the pack;
  - it carries the link rule and the pending-invite rule;
  - `PACK_ELSEWHERE` names it, and the rbac entry no longer says "member assignments".

  4 cases.
- **`constants/provisioned-stations.constants.test.ts` and `services/application.provision.test.ts`:** Administrate's slugs and description. 2 cases.
- **`__integration__/tools/member-tools.integration.test.ts`** (new, real DB):
  - an owner invites, and an invitation row exists with `invitedByUserId` set to the caller;
  - a duplicate invite gives `INVITATION_ALREADY_PENDING`;
  - a member without `member.invite` gets `TOOL_PERMISSION_DENIED` and no row is written;
  - `member_remove` of the last owner gives `LAST_OWNER_REMOVAL`;
  - `seat_usage` equals `GET /api/organization/members`'s `seatUsage`;
  - `invitation_show` with another org's invitation id gives `INVITATION_NOT_FOUND`;
  - the audit row has `userAgent: "portal-agent"`.

  7 cases.
- **`__integration__/services/provisioned-stations.integration.test.ts`:** a new org's Administrate has `member_management` attached. 1 case.

### Web

These cases live in `apps/web/src/__tests__/`.
- **`InviteLinkField.test.tsx`:** renders the link read-only, Copy calls back, and axe passes. 2 cases.
- **`InviteLinkDialog.test.tsx`** (dialog checklist where it applies):
  - it renders the title and link when `open`, and nothing when closed;
  - Copy calls `onCopy`;
  - Done, Escape and the close button call `onClose`;
  - Copy has focus on open;
  - axe passes on the open dialog (R6).

  5 cases.
- **`InvitationBlock.test.tsx`:**
  - it renders the email, role and expiry, with no link;
  - Get invite link calls `onGetLink`, and a `hide` gate shows no button;
  - a pending gate keeps the button focused and `aria-disabled`;
  - axe passes.

  4 cases.
- **`InvitationBlock.container.test.tsx`** (mocked SDK):
  - a successful resend opens the dialog with the returned link;
  - closing the dialog removes the link from the DOM;
  - a failed resend shows an error toast and no dialog.

  3 cases.
- **`MembersTab.test.tsx`:** unchanged expectations still pass with the extracted panel. 0 new cases.
- **`portal-stream.util.test.ts`:** an `invitation` result maps to its block. 1 case.
- **`invitation-block-renderer.util.test.tsx`:** an invalid content renders nothing. 1 case.
- **`ToolPackIconUtil.test.ts`:** the pack's icon maps. 1 case.

**Totals ≈ 73 cases** (core 15, api 40, web 18).

## Acceptance criteria

- [ ] **Inviting.** A caller with `member.invite` prompts "invite alice@example.com as a member".
  - A pending invitation is created, the same as Settings creates.
  - The portal shows an invitation block with no link.
  - "Get invite link" opens a dialog with the link and a Copy button. The link works and joins the org with that role.
  - Closing the dialog removes the link from the page.
- [ ] **No link stored.** No invite URL or token appears in the tool result the model sees, in `portal_messages.blocks`, or after a reload.
- [ ] **Same refusals as Settings.** A duplicate invite, a full seat count and an existing member are refused with Settings' text. For a duplicate, the agent shows the pending invitation rather than inviting again.
- [ ] **Permission refusals.** A caller without `member.invite`, or without `member.remove` for a removal, gets a typed refusal naming the permission, and nothing changes. The block's button is hidden for a viewer without `member.invite`.
- [ ] **Removal.** Removal follows `removeMember`'s rules: the last owner can't be removed, with the UI's refusal text.
- [ ] **Seats.** `seat_usage` matches Settings → Members' used and max.
- [ ] **Single shared tools.** A station with `rbac_management`, `member_management` and `view_management` gets one `member_list` and one `member_set_roles`.
- [ ] **Every plan.** The pack is available on standard, plus, pro, enterprise and custom tiers, with no tier apply.
- [ ] **Provisioning.** A new or reset org's Administrate station has `rbac_management`, `member_management` and `help`.
- [ ] **Clicking on a dead invitation.** Clicking "Get invite link" on a revoked or accepted invitation shows an error toast, and no link.

## Risks & rollback

- **The token leaking into stored or model-visible data.** Three checks guard it:
  - the `.strict()` block schema;
  - `toInvitationBlockContent`;
  - the integration probe on `portal_messages`.

  This is fail-closed: a result that isn't a valid block makes no block, and the agent sees only `{error, code}`.
- **A rotated link on every click.** Each click invalidates the previous link, which is the existing Resend semantics. The dialog's text says to copy and share it now.
- **Every tier is irreversible without a code change.** Moving a slug out of `ALWAYS_ENTITLED_PACKS` is the rollback.
- **Rollback overall:** revert the PR. No data or migration is involved, though provisioned Administrate stations keep the attached slug, which is harmless.

## Files touched

- **Core:**
  - `registries/{builtin-toolpacks,tool-capabilities,tool-phase-labels,station-data-packs}.ts`
  - `models/tool-capability.model.ts`
  - `contracts/{portal,invitation-block,index}.ts`
  - `content/{glossary,faq}.util.ts`
- **API:**
  - `tools/rbac/{invitation.tool,member.tool,rbac-tool.util}.ts`
  - `services/{seat,tools,portal}.service.ts`
  - `prompts/system.prompt.ts`
  - `constants/provisioned-stations.constants.ts`
- **Web:**
  - `components/{InviteLinkField,InviteLinkDialog,InvitationBlock,MembersTab}.component.tsx`
  - `utils/{invitation-block-renderer,portal-stream,tool-pack-icons}.util.ts(x)`
  - `api/invitations.api.ts`
  - `main.tsx`
- **Tests:** as listed above.
- **Docs:** `CLAUDE.md`, only if a convention line changes (none expected). Check `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` for the new interactive block.

## Next step

`docs/MEMBER_MANAGEMENT_TOOLPACK.plan.md` sequences five slices:
1. Core registration and the `invitation` contract.
2. The API tools, `runRbac` and the build wiring.
3. The display block, the web renderer, and the invite-link dialog with the extracted link field.
4. The prompt and help copy.
5. Administrate provisioning.
