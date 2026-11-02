# CLI org update audit — Condensed design (#936)

**Issue:** [EnterpriseBT/portal-ai#936](https://github.com/EnterpriseBT/portal-ai/issues/936) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalai org update --name` writes the org row and the operator's local `~/.portalai/audit.log`, but no `audit_log` entry and no Stripe customer update. So the org's Activity and its invoices disagree with the app. #907 audits an in-app rename and #935 an in-app default-station change, both as `org.update`, and the CLI should record the same entries. Decided with the user (2026-11-02): **audit both `--name` and `--default-station-id`** (closing #935's "CLI path, tracked separately"), and **report, don't sync** Stripe. `portalai` gets no Stripe credential; the result names the command to run. Touches `packages/admin-cli` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Command | `packages/admin-cli/src/commands/org.ts:28` (`orgUpdate`) | guard → operator → `store.updateOrg` → local audit `{ orgId, fields }` |
| Store write | `packages/admin-cli/src/store.ts` (`updateOrg`) | one unconditional `UPDATE … RETURNING`, no previous values, no lock; `--default-station-id` isn't checked against the org |
| Tables | `packages/admin-cli/src/tables.ts` | subsets of `organizations`, `users`, `organization_users`, `tiers`; held to the API schema by `tables-parity.test.ts` |
| Operator | `packages/admin-cli/src/session.ts` (`requireMutationOperator`) | the device-flow session's `sub`; locally the OS username if no session |
| API entries | `organization.router.ts` (#907, #935) | `org.update` `{ field: "name", from, to }` and `{ field: "defaultStationId", from, to, fromName, toName }`; `audit_log.user_id` is plain text, the actor |

## Decision — the CLI records the app's entries itself, in one transaction

- **Route through the API.** The API renames only the caller's current org, with `org.write` membership; an operator isn't a member of a customer's org. Rejected.
- **Write `audit_log` from the store.** Chosen. `updateOrg` runs in a transaction: lock the org row, read its name and default, validate a new default station against the org and read its name, write the patch, then insert one `org.update` row per field that actually changed. The shapes are #907's and #935's exactly, plus `via: "portalai"`. Entries commit with the change, so the CLI is stricter than the app's post-commit, fail-open write. There's no request to fail, and a rename shouldn't land unaudited.
- **Actor.** `user_id` is the operator's `users.id` when their session `sub` matches a user's `auth0_id`; otherwise the operator string itself (the `sub`, or the OS username locally). Activity then shows who, and an unmatched operator still reads as something meaningful.
- **Default-station check.** A `--default-station-id` that isn't a live station in that org is refused with `ADMIN_NOT_FOUND` (exit 8) and nothing is written. Today the CLI writes any id, including another org's, which the app's PATCH refuses.
- **Stripe.** When the name changed and the org has a `stripe_customer_id`, the result carries `stripe: { action: "update_customer_name", customerId, name, command: "stripe customers update <cus> --name '<new>'" }`. Human output prints it as a warning. Exit 0.

## Plan — 1 slice

**Files**
- `src/tables.ts`: subset `stations` (`id`, `organizationId`, `name`, `deleted`) and `auditLog` (`id`, base, `organizationId`, `userId`, `action`, `targetType`, `targetId`, `outcome`, `sourceIp`, `userAgent`, `metadata`).
- `src/store.ts`: `updateOrg` becomes the transaction above and returns `{ org, changes: { name?: {from,to}, defaultStationId?: {from,to,fromName,toName} } }`; it resolves the actor id by `auth0_id`.
- `src/commands/org.ts`: `orgUpdate` passes the operator, adds the `stripe` hint, and keeps the local audit line (now with the changed fields only).
- `src/bin.ts`: print the Stripe warning in human mode; `--json` returns `{ org, stripe? }`.
- `COMMANDS.md` (`org update`): Activity entries, the station check, the Stripe hint, and the new `--json` shape.

**Tests** (`npm run test:unit` in `packages/admin-cli`)
- `store.test.ts` (pglite): a rename writes one `org.update` `{field:"name",from,to,via}`; set, change and clear default each write one entry with names; a no-op writes none; name + station write two; a foreign or deleted station is `ADMIN_NOT_FOUND` with nothing written; the actor resolves to `users.id` by `auth0_id`, else the operator string.
- `commands.test.ts`: the `stripe` hint appears only for a changed name on an org with a customer.
- `tables-parity.test.ts`: the new subsets match the API schema.
- `npm run lint`, `npm run type-check`.

## Smoke (manual, against your dev stack)

1. Rebuild the CLI (`npm run build --workspace=packages/admin-cli`; `npx portalai` runs `dist/`). On an org with a Stripe customer: `npx portalai org update <org> --name "Renamed by CLI" --env local --yes --json`. The result has `org.name` and a `stripe.command`; Settings → Activity shows `Renamed from "…" to "Renamed by CLI"` by you. Run the printed command; `stripe customers retrieve <cus>` shows the new name.
2. The same command again: no new Activity line, no `stripe` hint.
3. `--default-station-id <a station in the org>`: Activity shows `Default station changed from "…" to "…"`.
4. `--default-station-id <another org's station>`: exit 8 `ADMIN_NOT_FOUND`; the default is unchanged and there's no Activity line.

## Out of scope

- Syncing Stripe from the CLI (decided against: no billing credential in `portalai`).
- Auditing `--timezone` (no Activity wording exists for it; the local operator audit still records it).
- Other `portalai` org mutations (`set-tier`, `delete`, `member …`) writing `audit_log`.
