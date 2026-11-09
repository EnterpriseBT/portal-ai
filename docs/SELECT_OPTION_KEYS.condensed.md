# Searchable selects key options by value — Condensed design (#986)

**Issue:** [EnterpriseBT/portal-ai#986](https://github.com/EnterpriseBT/portal-ai/issues/986) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why.** MUI's `Autocomplete` keys each option by `getOptionLabel` unless it's given `getOptionKey`. Our selects pass only the label, so two options with the same label share a React key: React logs "two children with the same key" and may drop or duplicate an option as the list re-renders, so a user can pick the wrong one. Add Member's "Link Field Mapping" list shows it: two mappings whose column definition is "Enum" both read "Enum", which also leaves them indistinguishable to anyone (WCAG 2.4.6). `packages/core` (the keys), `apps/web` (the mapping label, and three raw `Autocomplete`s with the same keying), and one line of `apps/api` (the mapping search, so the key in the label is searchable).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Single selects | `packages/core/src/ui/searchable-select/SearchableSelect.tsx:37`, `AsyncSearchableSelect.tsx:191`, `InfiniteScrollSelect.tsx:156` | `getOptionLabel={(o) => o.label}`, no `getOptionKey` |
| Multi selects | `MultiSearchableSelect.tsx:43`, `MultiAsyncSearchableSelect.tsx:137`, `MultiInfiniteScrollSelect.tsx:173` | Same. `MultiSearchableSelect`'s `renderOption` (:48) passes MUI's `key` through, so it is label-keyed too (the issue thought it wasn't) |
| `SelectOption` | `searchable-select/types.ts:3` | `value: string \| number` is the option's identity; `label` is display |
| Mapping option label | `apps/web/src/api/field-mappings.api.ts:154` | `fm.columnDefinition?.label ?? fm.sourceField`. The same `mapFn` labels the selected value through `loadSelectedOption` (:172) |
| Precedent | `field-mappings.api.ts:104` (`searchWithEntity`) | Labels a mapping `"sourceField (entityLabel)"` |
| Caller | `apps/web/src/views/EntityGroupDetail.view.tsx:456` → `AddGroupMemberDialog.component.tsx:100` | The only consumer of `searchWithColumnDefinition` |
| Raw `Autocomplete`s in web | `CuratedViewEditorDialog.component.tsx:173` (entity) and `:229` (columns), `CreatePortalDialog.component.tsx:67` (station), `CreateStationDialog.component.tsx:242` (toolpack) | Also keyed by label (code review). Entities, stations and packs can share a label |
| Mapping search | `apps/api/src/routes/field-mapping.router.ts:200` | `search` matched `sourceField` only, so the key now shown in the label wasn't searchable (code review) |
| Tests | `packages/core/src/__tests__/ui/SearchableSelect.test.tsx`, `MultiSearchableSelect.test.tsx` | One `describe` per component; none has duplicate labels |

## Decision — key by value in core, and disambiguate the mapping label

- **Keys.** All six selects pass `getOptionKey={selectOptionKey}`, one exported function (`searchable-select/option-key.ts`) returning `String(option.value)`. The value is already the identity (`isOptionEqualToValue` compares it), so keying by it fixes every list that can hold equal labels (column definitions, entities with the same name), not just this one. The four raw web `Autocomplete`s key by their own id (their option shapes differ).
- **The mapping label.** Options:
  - **A (chosen). `"<column label> (<key>)"`**, e.g. "Enum (region)" and "Enum (segment)", using the mapping's `normalizedKey`; just the source field when there's no column definition, as today. It follows `searchWithEntity`'s shape, reads the same in the list and in the selected field, and a screen reader hears the difference.
  - **B. A secondary line under the label.** `SelectOption` has no field for it, so this adds a new option shape to core for one list.
- The key, not the source field, because only the key is unique within an entity (`field_mappings_entity_normalized_key_unique`, `apps/api/src/db/schema/field-mappings.table.ts:50`). The list is filtered to one entity, so A always tells its options apart.
- **The search follows the label.** The list's `search` also matches `normalizedKey` (`or(ilike(sourceField), ilike(normalizedKey))`, as column definitions search label and key), so typing the key a user sees finds the option. The column label stays unsearchable here, as before: matching it needs a join this list doesn't do.

## Plan — 1 slice

**Files**
- Edit: the six `packages/core/src/ui/searchable-select/*Select.tsx` files (`getOptionKey`)
- New: `packages/core/src/ui/searchable-select/option-key.ts`
- Edit: `apps/web/src/api/field-mappings.api.ts` (`searchWithColumnDefinition`'s default label)
- Edit: `CuratedViewEditorDialog`, `CreatePortalDialog`, `CreateStationDialog` (`getOptionKey`)
- Edit: `apps/api/src/routes/field-mapping.router.ts` (search on the key; OpenAPI description)

**Tests** (failing first; `cd packages/core && npm run test:unit -- --testPathPattern SearchableSelect`)
- `SearchableSelect.test.tsx` (`SearchableSelect`, `AsyncSearchableSelect`, `InfiniteScrollSelect`) and `MultiSearchableSelect.test.tsx` (the three multi selects): two options with the same label and different values both render, open without a duplicate-key `console.error`, and picking the second reports its own value.
- `apps/web`: the mapping search labels an option "Enum (region)" from its column label and key, and a mapping with no column definition by its source field (`__tests__/api/field-mappings.api.test.ts`).
- `CuratedViewEditorDialog.test.tsx`: two entities labelled "Sheet1" both list without a duplicate-key error, and picking the second reports its id.
- `field-mapping.router.integration.test.ts`: `search` finds a mapping by its key and by its source field, case-insensitively.
- Then `npm run build` in `packages/core`, and `npm run lint && npm run type-check && npm run format:check` in all three packages.

## Smoke (manual, against your dev stack)

1. Signed in as the e2e owner, open an entity group and press **Add Member**. Pick "Customers", then open **Link Field Mapping**.
2. Each option reads "<column> (<key>)"; the two "Enum" mappings read "Enum (region)" and "Enum (segment)".
3. The browser console shows no "Encountered two children with the same key" while the list opens. Type `segm`: only "Enum (segment)" remains.
4. Pick the second "Enum" mapping. The field shows that option's label, and adding the member links that mapping: the new row's "Link Field" column shows its source field (`segment`, if that's the one you picked).
5. Open another searchable select (Add Member's entity list): it opens and filters as before, with no key warnings.

## Out of scope

- Other option labels that might collide (entities with the same name): keying fixes their React behaviour; making their text distinct is a per-list call, not this bug.
- A secondary-line slot on `SelectOption` (option B).
