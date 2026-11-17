# Role framing in relayed refusals — Condensed design (#1042)

**Issue:** [EnterpriseBT/portal-ai#1042](https://github.com/EnterpriseBT/portal-ai/issues/1042) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** When a tool refuses for lack of permission, the server's message names the permission ("You don't have permission to manage roles and access."). The assistant relays it and then adds who could do it instead: "you'll need a user with the appropriate admin privileges", "an owner/admin would need to do this", once naming the owner's email. That contradicts #711: permissions aren't tied to roles, so the advice can be wrong. `apps/api` only: prompt wording and a test.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The refusal the assistant relays | `apps/api/src/services/permission-gate.service.ts:62-68` | Typed tool result `TOOL_PERMISSION_DENIED` with the server's message. Correct today |
| Curated Views Notes | `apps/api/src/prompts/system.prompt.ts:683-687` | The only place that says "Say which permission is missing; don't point them to an admin or name a role." Rendered only when that pack is on the station |
| Access & Roles Notes | `apps/api/src/prompts/system.prompt.ts:640-642` | "relay it plainly and do not retry". Nothing about roles |
| Entity Management Notes | `apps/api/src/prompts/system.prompt.ts:518-520` | "say which permission is missing. Don't retry". Nothing about roles |
| Pack-independent rules | `apps/api/src/prompts/system.prompt.ts:816` ("If no tool fits…") | Rendered for every station. No refusal rule here |
| The copy guard | `apps/api/src/__tests__/permission-copy.guard.test.ts` | Scans authored text for role-framed phrasing. It can't see model output |

All four quotes in the ticket came from a station with only the Access & Roles pack, where the rule isn't in the prompt at all.

## Decision — where the rule lives

- **A. Copy the sentence into the Access & Roles and Entity Management notes.** Three copies to keep in step, and a tool outside those packs (a custom tool, a future pack) gets none.
- **B. One rule in the pack-independent list, rendered on every station; the Curated Views copy is removed.** Covers every tool's refusal.
- **C. Put the instruction in the refusal itself** (a field on the `TOOL_PERMISSION_DENIED` result). Reaches the model at the moment it matters, but turns a typed result into a carrier for prompt text, and every consumer of that result would have to ignore the field.

**Decided: B.** After the "If no tool fits" rule:

> **When a tool refuses because the user lacks a permission ("You don't have permission to …"), say which permission is missing and stop there.** Name the permission, and the object by its name rather than an id from the message. Don't retry, and don't route the request through another tool. Don't add who could do it or grant it: no role ("someone with admin rights") and no person picked from the member list, even when the user asks who to ask. Permissions here aren't tied to roles, so that guess can be wrong. If the user asks how to get access, the answer is that they can ask for that permission to be granted. This is about that one inference and nothing else. A refusal that gives a different reason is relayed with its reason: a plan limit (point at Settings → Subscription & Billing; no grant fixes it), a rule about who may assign particular roles, or a reason from an organization-provided tool. And a question about who the members are or which roles they hold is answered from the tools as usual.

How it got to this wording:

- **"No person picked from the member list"** is beyond #711, which is about roles. One walk answer volunteered the owner's email.
- **"Even when the user asks who to ask"** was added after walking the first wording. Asked "How can I get permission to do that?" with the member list already in the conversation, the assistant answered that the other member "has the owner role and would be able to make those changes for you", with their email.
- **The scope sentences** were added after code review. The same result code (`TOOL_PERMISSION_DENIED`) also carries a plan limit ("Your plan does not include custom RBAC authoring"), the rule about assigning the owner and admin roles, and whatever an organization's own tool answers. "Ask for the permission to be granted" is wrong for each. And without the last sentence the rule could read as a ban on listing members and their roles.
- **"The object by its name rather than an id"**: the gate's messages carry raw ids ("permission to edit connector 37910367-…").
- **"Don't retry, and don't route…"** is in the rule so it covers tools outside the three packs whose notes say it. Those notes keep their own sentences, which carry pack-specific facts (what a plan limit looks like for access tools; `TOOL_TARGET_NOT_FOUND` for entities).

This is guidance to a model, so it lowers how often the framing appears; it can't guarantee zero. The smoke steps check the cases the ticket recorded.

## Plan — one slice

**Files**
- Edit: `apps/api/src/prompts/system.prompt.ts` — add the rule to the base list; drop the Curated Views sentence it replaces.

**Tests** (written first; `npm run test:unit -- --testPathPattern "system.prompt|permission-copy"` in `apps/api`)
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — the rule renders for every pack set, an empty one included, and exactly once on a station with the Curated Views pack.
- `permission-copy.guard.test.ts` must still pass: the rule itself must not trip the role-phrasing patterns.
- Then `npm run lint`, `npm run type-check`, `npm run format:check` in `apps/api`.

## Smoke (manual, against your dev stack)

Two fresh orgs (`portalai org create`). **Org E** is moved to the enterprise plan (`portalai org set-tier <org> enterprise`), which includes custom roles, and has a default member added (`portalai member add`). **Org S** stays on the plan it was created with, which doesn't. Wording is relayed by a model, so read each answer for what it must not contain.

As the member, in org E:

1. On **Administrate**, send: "Create a role called Auditors." The answer says the member doesn't have permission to manage roles and access. It doesn't mention an admin, an owner, an administrator or "privileges", and names no person or email.
2. Same portal: "Who are the members of this organization and what roles do they have?" The answer lists the members with their roles. (A plain question about members is still answered after a refusal.)
3. Same portal: "So how can I get permission to create that role? Who should I ask?" The answer says they can ask for the permission to be granted and declines to pick a person, though the member list is in the conversation.
4. On **Playground**, send: "Create an entity called Gadgets on the Sandbox connector with a text column called name." The answer says the member lacks write permission on the Sandbox connector, by name, with no id. No entity is created.

As the owner, in org S:

5. On **Administrate**, send: "Create a role called Auditors." The answer says the plan doesn't include custom roles and points at Settings → Subscription & Billing. It doesn't say a permission is missing.
6. Same portal: "How do I get access to do that?" The answer is about the plan, not about asking for a permission to be granted.

Not walkable locally: the refusal for assigning the owner or admin role as someone who isn't the owner, which needs a local admin identity. The prompt test covers that the rule leaves that refusal its own reason.

## Out of scope

- **The refusal messages themselves.** They already name the permission.
- **Other role mentions that are correct**, such as the assistant listing a member's roles when asked, or explaining that owner and admin assignment has its own rule.
- **Guaranteeing the wording.** A model can still phrase a refusal badly; this removes the gap that let it happen on every station without the Curated Views pack.
