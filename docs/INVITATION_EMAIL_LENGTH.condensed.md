# Cap the length of invitation emails — Condensed design (#1101)

**Issue:** [EnterpriseBT/portal-ai#1101](https://github.com/EnterpriseBT/portal-ai/issues/1101) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `InviteCreateRequestSchema.email` is `z.string().email()` with no `.max()`, so Settings → Members and the assistant's `member_invite` (#847) both accept a 300-character address, store it, and show it in the pending list and the invitation block. RFC 5321 caps an address at 254 characters and #801 says user-authored text on a request contract has a limit. The fix is an `emailField` builder beside `nameField`/`descriptionField`/`keyField`, used by every request contract that takes an email, and an `email` entry in the #801 guard so a new unbounded one fails CI. Core only; web and the API pick it up through the shared contract.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Invite request contract | `packages/core/src/contracts/invitation.contract.ts:19` | `email: z.string().email()`, no max, no trim |
| Length builders | `packages/core/src/contracts/text-limits.contract.ts:28-44` | `nameField`/`descriptionField`/`keyField` + `tooLongMessage` |
| SSO discovery contract | `packages/core/src/contracts/sso-discovery.contract.ts:12` | `z.string().trim().email("Enter a valid email address").max(320)`: bounded, but inline and at 320 |
| #801 guard | `packages/core/src/__tests__/contracts/name-length.guard.test.ts:17` | `GUARDED_FIELDS` has no `email` |
| Settings route | `apps/api/src/routes/organization.router.ts:717` | `safeParse` → `invalidPayload(ORGANIZATION_INVALID_PAYLOAD)`: 400 for free |
| `member_invite` tool | `apps/api/src/tools/rbac/invitation.tool.ts:29` | `InviteCreateRequestSchema.extend({ role })`: inherits the field |
| Invite dialog | `apps/web/src/components/InviteMemberDialog.component.tsx:33` | `validateWithSchema(InviteCreateRequestSchema, form)`, trims on submit (`:91`) |

Other email inputs checked: `auth.contract.ts:42` is Auth0's claim shape (not user-authored, not a request body); `admin-cli`'s `--owner-email` looks up an existing user and stores nothing.

## Decision — one `emailField` builder, trimmed, 254, length checked first

- **Builder, not inline `.max(254)`.** Same reason #801 gave for names: the API's 400, the inline error and the guard read one rule. `EMAIL_MAX_LENGTH = 254` (RFC 5321 path limit minus the brackets) beside the other constants.
- **Shape:** `z.string().trim().max(EMAIL_MAX_LENGTH, tooLongMessage(field, 254)).email("Enter a valid email address")`. `.max` precedes `.email` so an over-long address reports its length (the route's message names the *first* issue), not "invalid". `.trim()` matches the dialog, which already trims before sending, and the SSO contract; it makes the API accept `" a@b.com "` as `a@b.com` instead of 400ing, which is the dialog's existing behaviour.
- **SSO discovery adopts it too**, moving 320 → 254. 320 is the oft-quoted local(64)+@+domain(255) sum, not a deliverable address; nothing longer than 254 can sign in. The message there is unchanged ("Enter a valid email address"), so `SsoLoginFormView.test.tsx` holds.
- **Invite's invalid-format message** changes from Zod's default "Invalid email address" to "Enter a valid email address" (one wording across the app). No test asserts the old text.
- **Guard:** add `email` to `GUARDED_FIELDS` and `InviteCreateRequestSchema.email` to the sweep's sentinel list. Models (`InvitationSchema`, `MemberSchema`) stay unbounded, per the text-limits file rule.

## Plan — one slice

**Files**
- Edit `packages/core/src/contracts/text-limits.contract.ts`: `EMAIL_MAX_LENGTH`, `emailField(field = "Email")`.
- Edit `packages/core/src/contracts/invitation.contract.ts` and `sso-discovery.contract.ts`: use `emailField()`.
- Edit `packages/core/src/__tests__/contracts/name-length.guard.test.ts`: `email` guarded; sentinel entry; header comment names `emailField`.

**Tests** (failing first)
- `packages/core/src/__tests__/contracts/invitation.contract.test.ts`: 254-char address accepted; `"a".repeat(288) + "@example.com"` rejected with `Email must be 254 characters or fewer` as the first issue; padded address parses trimmed.
- Guard test above (red before the contract edit if `email` is guarded first).
- `apps/api/src/__tests__/tools/rbac/invitation-tools.test.ts`: `member_invite` with the 300-char address returns an `{ error }` result and `SeatService.invite` is never called (added to the existing bad-input loop).
- `apps/web/src/__tests__/InviteMemberDialog.test.tsx`: typing an over-long address and submitting shows the length error with `aria-invalid="true"` and doesn't call `onSubmit`.
- `npm run test:unit` scoped to these files (core, api, web), `npm run build` (core contract change, run the root build), `type-check`, `lint`.

**Docs:** `troubleshooting.util.ts` needs nothing (a field error explains itself); swagger references the contract through `z.toJSONSchema`, so `maxLength` appears with no edit.

## Smoke (manual, against your dev stack)

1. Settings → Members → Invite: paste a 300-character address (`"a"×288@example.com`), leave the field → "Email must be 254 characters or fewer", field marked invalid; Invite does nothing. Nothing appears in Pending.
2. Same dialog, a normal address with a leading/trailing space → invitation created; Pending shows it without the spaces.
3. In a portal, ask the assistant to invite the 300-character address → `member_invite` fails input validation and the assistant reports it; no invitation block, nothing in Pending.
4. `POST /api/organization/invitations` with the long address (devtools/curl) → `400 ORGANIZATION_INVALID_PAYLOAD`, message names `email`.
5. Sign-in page → "Sign in with SSO" with a 300-character address → field error; a normal work email still resolves as before.

## Out of scope

- Bounding existing stored invitations or `users.email`: nothing over 254 can be accepted, and models stay unbounded by rule.
- Per-part RFC checks (64-char local part, label lengths): Zod's format check plus the total cap is the bar.
- `admin-cli --owner-email`: a lookup of an existing user, not stored input.
