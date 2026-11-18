# The follow-up answer after the role-assignment rule refuses — Condensed design (#1056)

**Issue:** [EnterpriseBT/portal-ai#1056](https://github.com/EnterpriseBT/portal-ai/issues/1056) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A caller with `member.role.assign` who isn't an owner asks the assistant to make someone an admin. The refusal is relayed correctly with the rule's own reason. Asked "How do I get access to do that?", the assistant then says to ask for that permission to be granted. There is no such permission: an owner has to make the change. `apps/api` only: prompt wording and its test.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The rule that refuses | `apps/api/src/services/seat.service.ts:700-705` | `403 MEMBER_ROLE_ASSIGNMENT_RESTRICTED`, "Only the owner can assign or remove the owner or admin role". The one refusal that names roles (#711) |
| What the assistant sees | the tool result | `TOOL_PERMISSION_DENIED` with that message, the same code a missing permission carries |
| The refusal rule | `apps/api/src/prompts/system.prompt.ts:838-857` | "If the user asks how to get access, the answer is that they can ask for that permission to be granted." Then the carve-out: a refusal with a different reason "is relayed with its reason", listing a plan limit, the role-assignment rule and an organization tool's reason |
| Its test | `apps/api/src/__tests__/prompts/system.prompt.test.ts:368-445` | Pins the phrases that carry behaviour, including each carve-out |
| The copy guard | `apps/api/src/__tests__/permission-copy.guard.test.ts:24-35` | Fails on "only the owner", "owner or admin" in any API source, the prompt included |

The carve-out covers the relay and stops. The only sentence in the prompt about a follow-up question is the general one, so the assistant applies it. The plan limit already carries its own follow-up ("no grant fixes it"); the role rule and the organization tool's reason carry none.

## Decision — where the follow-up answer comes from

- **A. Say it in the prompt rule.** The carve-out states that the refusal's reason is also the answer to "how do I get access", and gives the role rule its own: it isn't a permission, and someone who holds the role the message names has to make the change.
- **B. Say it in the refusal's message** (`seat.service.ts`: "…This isn't a permission that can be granted."). It reaches the model at the moment it matters, and the web shows the same text. But the prompt sentence that produces the wrong answer would still be there, the message is allowlisted verbatim in the copy guard, and the web dialog showing it doesn't have this problem.

**Decided: A.** The rule's last part becomes (changes in bold):

> If the user asks how to get access **after a missing permission refused them**, the answer is that they can ask for that permission to be granted. This is about that one inference and nothing else. A refusal that gives a different reason is relayed with its reason, **and that reason is still the answer if the user asks how to get access**: a plan limit (point at Settings → Subscription & Billing; no grant fixes it), a rule about who may assign particular roles, or a reason from an organization-provided tool. **For the role rule, "how do I get access?" has one answer: an owner has to make that change themselves. Nothing is granted here, so don't suggest asking for a permission or for the owner role, and still don't pick out a person from the member list.** And a question about who the members are or which roles they hold is answered from the tools as usual.

The Access & Roles notes said every refusal means "the user (or their plan) lacks that permission", on the only stations where this rule can fire. They now say a refusal to assign particular roles is a rule, not a permission the user lacks.

How it got to this wording (each step is something a walk or the review produced):

- **"someone who holds the role the message names"** (first draft). The message names the roles being assigned as well as the one that may assign them. The relay then listed "someone with the owner role" from the member list, including the caller, who is an admin.
- **"the message says who can make the change"**, then **"neither a permission nor a role"** in a parenthesis. The follow-up became "You can ask for the owner role to be granted to you", four times in five.
- **The general sentence was the cause.** "They can ask for that permission to be granted" was being applied with the owner role in place of the permission. Scoping it to a missing permission, and giving the role rule its answer as its own sentence, got "Only an owner can make that change. You'd need to ask an owner of the organization…" on both samples.
- **It names the owner.** Leaving the role to the message kept the prompt from restating the rule, and that was what made it ambiguous. #711 allows this one rule to name a role; the wording passes the copy guard as written.

## Plan — one slice

**Files**
- Edit: `apps/api/src/prompts/system.prompt.ts` — the refusal rule's last part and its code comment; the Access & Roles notes' sentence about refusals.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — a "the role-assignment rule (#1056)" block, built with the access pack (the only pack whose tool returns this refusal): the follow-up clause, the owner sentence, the scoped general sentence, no person from the member list, and the pack notes not contradicting it.

**Tests**
- `npm run test:unit` in `apps/api`, limited to `system.prompt` and `permission-copy.guard`.
- `npm run lint`, `npm run type-check`, `npm run format:check`.

**Docs check.** The agent contract's third surface is the prompt itself. No tool description, `builtin-toolpacks.ts` mirror, Help content or durable doc describes this follow-up.

## Smoke (manual, against your dev stack)

Signed in as a member who holds the admin role and is not an owner, in a portal on a station with the Access & Roles pack, on a plan that includes it.

1. "Make <another member> an admin, keeping their member role." → refused with the rule's reason (only an owner can assign or remove the admin and owner roles). No retry.
2. "How do I get access to do that?" → says an owner has to make the change. Doesn't say to ask for a permission or for the owner role. Names no person.
3. "Who is the owner?" → answered from the member list.
4. Regression (#1042), as a member who can't manage roles: "Create a role called Analysts", then "How do I get access?" → names the missing permission (manage roles and access), says to ask for it to be granted, and names no role and no person.

## Out of scope

- Changing the refusal's message or code (option B).
- Giving the role-assignment rule its own tool result code. It would let the prompt key on the code instead of the wording, but it changes the tool result contract for one rare case.
- The plan-limit follow-up, which is already right.
