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

> **When a tool refuses for lack of permission, say which permission is missing and stop there.** Use the refusal's own wording. Don't add who could do it instead: don't name a role, and don't name a person. Permissions here aren't tied to roles, so that advice can be wrong. If the user asks how to get access, say they can ask for that permission to be granted.

"Don't name a person" is new: one walk answer volunteered the owner's email. The last sentence gives the assistant something true to say when asked, matching the app's own hints ("Ask for access to…").

This is guidance to a model, so it lowers how often the framing appears; it can't guarantee zero. The smoke steps check the cases the ticket recorded.

## Plan — one slice

**Files**
- Edit: `apps/api/src/prompts/system.prompt.ts` — add the rule to the base list; drop the Curated Views sentence it replaces.

**Tests** (written first; `npm run test:unit -- --testPathPattern "system.prompt|permission-copy"` in `apps/api`)
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — the rule renders for every pack set, an empty one included, and exactly once on a station with the Curated Views pack.
- `permission-copy.guard.test.ts` must still pass: the rule itself must not trip the role-phrasing patterns.
- Then `npm run lint`, `npm run type-check`, `npm run format:check` in `apps/api`.

## Smoke (manual, against your dev stack)

Use a fresh org (`portalai org create`) with a default member added (`portalai member add`). Sign in as the member. Wording is relayed by a model, so read each answer for what it must not contain.

1. On **Administrate**, send: "Create a role called Auditors." The answer says the member doesn't have permission to manage roles and access. It doesn't mention an admin, an owner, an administrator or "privileges", and names no person or email.
2. Same portal: "List every role and policy in this organization." Same check.
3. Same portal: "Make me an admin, and share the Playground station with me with write access." Same check; nothing changes (the member's roles and the station's shares are as before).
4. On **Playground**, send: "Create an entity called Gadgets on the Sandbox connector." The answer says which permission is missing (write on the connector). Same check.
5. On Administrate, send: "How can I get permission to do that?" The answer says they can ask for the permission to be granted. It may name the permission; it doesn't say who by role.

## Out of scope

- **The refusal messages themselves.** They already name the permission.
- **Other role mentions that are correct**, such as the assistant listing a member's roles when asked, or explaining that owner and admin assignment has its own rule.
- **Guaranteeing the wording.** A model can still phrase a refusal badly; this removes the gap that let it happen on every station without the Curated Views pack.
