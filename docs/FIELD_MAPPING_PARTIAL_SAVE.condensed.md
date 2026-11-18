# Edit Field Mapping sends only what changed — Condensed design (#1061)

**Issue:** [EnterpriseBT/portal-ai#1061](https://github.com/EnterpriseBT/portal-ai/issues/1061) · Bug · **condensed, widened in review** (discovery + spec + plan + smoke in one doc). Code review showed the web-only fix still reverted another editor's column switch and source rename, so the contract change the ticket called `full` was taken in this PR. It touches three packages, but the API change is docs only, since the route already wrote just the keys it received.

**Why.** Edit Field Mapping's `buildBody` sent every field the form held on every save. When two editors had the same mapping open, the second save put back the first editor's change to a field the second never touched: required, default value, format, enum values, primary key, the reference keys, the source field, or the column definition. Now the dialog sends only what differs from the mapping it opened on, and the contract lets it.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `buildBody` | `apps/web/src/components/EditFieldMappingDialog.component.tsx:170-195` | Whole form every time; only `normalizedKey` conditional (#801) |
| `needsRevalidation` | same file, `:197-213` | Compares five fields; the server revalidates on eight (`VALIDATION_RULE_FIELDS`, `apps/api/src/services/field-mappings/reconcile.ts:118`) |
| Revalidation warning | same file, `:246-252` | Confirm & Save sends the body captured when the warning appeared, even after later edits |
| Compare base | `views/ColumnDefinitionDetail.view.tsx:91`, `:392`, `:422-450` | The row stored when Edit was clicked; doesn't refetch while open |
| Reference pattern | `components/EditColumnDefinitionDialog.component.tsx:164-182` | Starts from `{}` and adds each changed field |
| Contract | `packages/core/src/contracts/field-mapping.contract.ts:144-157` | `sourceField`, `columnDefinitionId` required |
| Route | `apps/api/src/routes/field-mapping.router.ts:691` (PATCH), `:825` | Writes `...parsed.data`; already treats `columnDefinitionId` as optional (`if (parsed.data.columnDefinitionId)`, `?? existing`) |

## Decision: every field optional; the dialog sends only changes

- **Contract.** All fields of `FieldMappingUpdateRequestBodySchema` are optional. An empty body is refused (`.refine`, so 400 `FIELD_MAPPING_INVALID_PAYLOAD`), since it would change nothing. The route needs no logic change; its #832 comment and OpenAPI block are updated, and the body is registered as the `FieldMappingUpdateRequestBody` component.
- **`buildBody`** starts from `{}`. It adds each field whose form value differs from `fm`:
  - Text is trimmed and an empty value becomes `null`. It's compared with the stored value as-is, so removing stray stored whitespace counts as a change.
  - An enum list is compared after normalizing both sides (trim, drop empties).
  - A column that's no longer an enum but still holds a list gets `enumValues: null`, as every save used to do.
- **No changes** means no request: Save closes the dialog.
- **Revalidation prompt.** `REVALIDATION_FIELDS` matches the server's eight fields. The prompt shows when the body carries any of them. Any edit made after the prompt appears retires it, so Confirm & Save can't send a stale body.
- **Page refetch.** `ColumnDefinitionDetail` refetches column definitions only when a body carries `columnDefinitionId`. That rule is unchanged, and it's now accurate.

## Plan: 1 slice

**Files:**
- `packages/core/src/contracts/field-mapping.contract.ts`
- `apps/api/src/routes/field-mapping.router.ts` (docs and comment)
- `apps/api/src/config/swagger.config.ts`
- `apps/web/src/components/EditFieldMappingDialog.component.tsx`

**Tests:**
- `packages/core/src/__tests__/contracts/field-mapping.contract.test.ts`: a body with one field (`format`, `sourceField` or `columnDefinitionId`) is accepted; `{}` is rejected.
- `apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts`:
  - `{ isPrimaryKey: true }` writes only that field and leaves a renamed `sourceField` and the `columnDefinitionId` as stored;
  - `{}` is a 400.
- `apps/web/src/__tests__/EditFieldMappingDialog.test.tsx`:
  - an unchanged Save closes without submitting;
  - a lone rename, one changed field, the Required and Primary Key toggles, and the Enter key each send exactly that field;
  - a whitespace-only change to format or enum is unchanged, while stored whitespace can be removed;
  - a stale enum list is cleared;
  - a reference key change prompts for revalidation;
  - an edit after the prompt retires it.
- `dialog-single-flight.integration.test.tsx` and the ColumnDefinitionDetail tests still pass.

## Smoke (manual, against your dev stack)

1. Open a column definition that has a field mapping. Open **Edit** on the mapping in two browser windows (A and B).
2. In B, turn on **Required**, confirm the revalidation, and save.
3. In A, which still shows Required off, change only **Format** and save.
4. Reload. The mapping is **Required** and has A's format. In the Network tab, A's PATCH body is `{ "format": … }` only.
5. With A and B open again: B changes **Source Field** and saves; A toggles **Primary Key** and saves. After reload, B's source field stands.
6. Open Edit and click Save without changing anything. The dialog closes and no PATCH is sent.
7. On a reference mapping, change **Ref Normalized Key**. The revalidation prompt appears. Edit any field: the prompt goes away until Save is pressed again.
8. Put the mapping back as it was.

## Out of scope

- Detecting or warning about a concurrent edit (version or ETag checks). Two editors changing the *same* field still end on the last save.
- The agent's `field_mapping_update` tool, which has its own input schema.
