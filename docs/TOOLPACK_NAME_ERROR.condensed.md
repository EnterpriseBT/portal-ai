# Toolpack name error message — Condensed design (#914)

**Issue:** [EnterpriseBT/portal-ai#914](https://github.com/EnterpriseBT/portal-ai/issues/914) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Leaving a toolpack's Name empty, or typing an invalid one, shows Zod's raw message `Invalid string: must match pattern /^[a-z][a-z0-9_]{0,62}$/` under the field, and the API's `400 TOOLPACK_INVALID_PAYLOAD` says the same. Give the name rule messages people can read, defined once in the request contract so the inline error and the API's 400 read the same (#801's convention). Only `packages/core` changes; the web dialogs already render the contract's message.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The rule | `TOOLPACK_SLUG_REGEX = /^[a-z][a-z0-9_]{0,62}$/` in `packages/core/src/models/organization-toolpack.model.ts:26` | Starts with a letter; lowercase letters, digits, underscores; 1–63 chars |
| Register body | `RegisterToolpackBodySchema.name` in `packages/core/src/contracts/toolpack.contract.ts:136` | `z.string().regex(TOOLPACK_SLUG_REGEX)` with no message |
| Update body | `UpdateToolpackBodySchema.name` in `toolpack.contract.ts:147` | Same, `.optional()` |
| Shared field helpers | `nameField` / `keyField` / `tooLongMessage` in `packages/core/src/contracts/text-limits.contract.ts` | #801's messages: "Name is required", "… must be N characters or fewer" |
| Dialogs | `RegisterToolpackDialog` (`fieldError("name")`) and `EditToolpackDialog:261-262` | Already show the contract's first issue for `name`; no change needed |

## Decision — one `toolpackNameField()` in the contract

Add `toolpackNameField()` to `toolpack.contract.ts`. It checks, in order:
1. `min(1, "Name is required")`;
2. `max(63, tooLongMessage("Name", 63))`;
3. `regex(TOOLPACK_SLUG_REGEX, "Name must start with a lowercase letter and use only lowercase letters, digits and underscores")`.

Both body schemas use it (Update adds `.optional()`). Order matters because the dialog shows the first issue: an empty name reads "Name is required", not the pattern message.

- **Why not reuse `nameField()`:** it trims and allows any characters up to 120. A toolpack name is a slug: its tools are namespaced by it, so the rule stays stricter.
- **The model schema keeps its bare regex.** Stored rows stay readable, and per #801 the limits live on request contracts only.
- **No API code changes.** The router already answers `invalidPayload(...)` with the first issue's message, so the 400 picks the new text up automatically.

## Plan — 1 slice

- **Files:** `packages/core/src/contracts/toolpack.contract.ts` (helper + both schemas).
- **Tests (test first):**
  - `packages/core/src/__tests__/contracts/toolpack.contract.test.ts`: `""` → "Name is required"; `"Bad Name"` and `"9pack"` → the pattern message; 64 characters → "Name must be 63 characters or fewer"; `"customer_intel"` passes. Both schemas covered. Assert that no message contains `Invalid string` or `/^`.
  - `apps/web/src/__tests__/RegisterToolpackDialog.test.tsx`: blurring an empty Name shows "Name is required" with `aria-invalid="true"`; `"Bad Name"` shows the pattern message.
  - Run `npm run test:unit` in `packages/core` and `apps/web`, then `npm run build`, `type-check` and `lint`.

## Smoke (manual, against your dev stack)

1. Toolpacks → **Register toolpack**. Click into Name, then into Description. Expected: "Name is required" under Name (no regex), with the field red.
2. Type `Bad Name`, then blur. Expected: "Name must start with a lowercase letter and use only lowercase letters, digits and underscores".
3. Type 64 `a` characters. Expected: "Name must be 63 characters or fewer".
4. Type `customer_intel`. Expected: the error clears and the helper text returns.
5. In the Edit dialog of an existing custom toolpack, rename it to `Bad Name` and Save. Expected: the same pattern message, and Save is blocked.
6. `curl -X POST $API/api/toolpacks -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '{"name":"","endpoints":{"schema":"https://x/s","runtime":"https://x/r"}}'`. Expected: `400 TOOLPACK_INVALID_PAYLOAD` whose message names "Name is required".

## Out of scope

- **The same pattern without a message on keys.** `column-definition.contract.ts:62`, `connector-entity.contract.ts:111`, `field-mapping.contract.ts:106` and `api-connector.contract.ts:253` use `/^[a-z][a-z0-9_]*$/` with no message. Checked: their dialogs validate with their own form schemas, which carry readable messages (`CreateColumnDefinitionDialog`, `CreateConnectorEntityDialog`, `CreateFieldMappingDialog`, `rest-api-validation.util.ts`), so users don't see the raw pattern. Only those routes' API 400s carry it. Not folded in.
- Changing the slug rule itself.
