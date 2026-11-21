# Tell the portal agent who the prompting user is — Condensed design (#1100)

**Issue:** [EnterpriseBT/portal-ai#1100](https://github.com/EnterpriseBT/portal-ai/issues/1100) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The agent can't resolve "me": "make me an admin" or "remove everyone except me" make it ask for the user's email (#847's adversarial walk). Every turn already runs as the prompting user, but neither the system prompt nor `station_context` says who that is.

The change: each turn's system prompt names the caller, with their display name, email, `userId` and roles in the current organization, plus guidance to use that `userId` for "me". It touches `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Per-turn context | `apps/api/src/routes/portal-events.router.ts:198` → `buildStationContext({ station, organizationId, userId: turnUserId })` | Rebuilt every message (#95), as the message's author (#685) |
| `buildStationContext` | `apps/api/src/services/portal.service.ts:1490` | Has `userId`, uses it only to scope the roster and attachments |
| `StationContext` | `apps/api/src/prompts/system.prompt.ts:50` | Nothing about the caller |
| Prompt opening | `system.prompt.ts:883` (`You are an analytics assistant for the "<station>" station.`) | First line, before `## Your role: route to a tool` |
| Member shape | `apps/api/src/services/seat.service.ts:172` `listMembers(caller)` | `users` ⋈ `organization_users`, then `user_role` ⋈ `roles` for system `roles` + every `roleSlugs`, then `user_group`; org-scoped, soft-deletes guarded |

## Decision — one member loader, a `caller` on the context, a prompt section

**Loading.** `listMembers`'s body becomes a private `loadMembers(organizationId, userIds?)`. `listMembers` calls it unchanged, and a new `SeatService.getMember(organizationId, userId): Promise<Member | null>` calls it with one id. The caller's record therefore has exactly the shape and role logic `member_list` returns, scoped to this organization only. Duplicating the queries was rejected, because the two could drift.

**Context.** `StationContext` gains an optional `caller?: CallerIdentity` with `{ userId, name: string | null, email: string | null, roles: OrgRole[], roleSlugs: string[] }`. It's optional so contexts built without a caller (tests, callers that don't need it) still type-check. `buildStationContext` fills it from `getMember`. If that returns `null`, which shouldn't happen once membership is proven, it falls back to `{ userId, name: null, email: null, roles: [], roleSlugs: [] }`, and the turn never fails for it.

**Prompt.** A `## Who You're Talking To` section directly after the opening line. It's present whenever `caller` is set.

- **The identity line:**
  - **Name:** `You're talking to <name> (<email>, userId \`<id>\`)`. With no name, the email is used: `You're talking to <email> (userId \`<id>\`)`. With neither: `You're talking to the user with userId \`<id>\``.
  - **Roles:** then `, <system roles joined> in this organization (role slugs: \`a\`, \`b\`).` With no roles: `, with no roles in this organization.`
- **Guidance:** "When they say "me", "my" or "myself", they mean this user: use this `userId` directly rather than asking who they are, and never act on them when they exclude themselves ("everyone except me"). This says who they are, not what they may do: every tool call is still checked against their permissions."
- **Text hygiene:** the name and email are user-controlled text placed in the system prompt. Each has control characters and backticks stripped, newlines collapsed to spaces, and is clipped to 120 characters, so a crafted display name can't break the line or open a code span. The `userId` is a system id and is used as is.

## Plan — 2 slices

**Slice 1: `SeatService.getMember`.**
- **Files:** `apps/api/src/services/seat.service.ts`.
- **Tests:** `apps/api/src/__tests__/__integration__/services/seat.service.integration.test.ts`:
  - `getMember` returns the owner with `roles: ["owner"]` and their slugs;
  - after a custom role is assigned, the slug is included;
  - it returns `null` for a user in another org (no cross-org leak) and for a removed member;
  - `listMembers` is unchanged (existing cases).

**Slice 2: context + prompt.**
- **Files:** `portal.service.ts` (`buildStationContext` fills `caller`), `system.prompt.ts` (`CallerIdentity`, the section, a `promptSafeText` helper).
- **Tests:**
  - `apps/api/src/__tests__/prompts/system.prompt.test.ts`:
    - the full line;
    - name → email → userId fallbacks;
    - system roles and slugs, and the no-roles wording;
    - the "me" / "except me" guidance;
    - the section sits right after the opening line, and is absent without `caller`;
    - a name with a newline, backticks and 300 characters renders on one line, clipped, with no backtick.
  - `apps/api/src/__tests__/services/portal.service.test.ts`, `buildStationContext` (with `SeatService.getMember` mocked):
    - it passes the turn's `organizationId` and `userId`;
    - it sets `caller` from the member;
    - a `null` member falls back to userId only.

`npm run test:unit` and `npm run test:integration -- --testPathPattern seat.service` (api), `type-check`, `lint`.

## Smoke (manual, against your dev stack)

Prep: a station with the Members pack, and the e2e owner and member identities.

1. As the owner, open a portal and ask "who am I?" → the agent names you, your email and "owner", without a tool call.
2. As the member: "make me an admin" → it calls `member_set_roles` with your own `userId` straight away (no question about who you are), and relays the refusal (needs `member.role.assign`).
3. As the owner, with two disposable invited-and-accepted members: "remove everyone except me" → `member_remove` for each of them, never for you, with no clarifying question.
4. As the owner, give the member a custom role in Settings, then in the member's open portal ask "what roles do I have?" → the new slug appears in the next turn.

## Out of scope

- Effective permissions in the prompt (the server stays the gate), and a `caller` field in `station_context`'s output.
- Other users' details beyond what `member_list` already returns.
