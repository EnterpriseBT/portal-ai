# Edit Station tool pack changes — Plan

**Implements the spec's `toolPackChanges` contract, TDD-sequenced so every commit builds and passes: the new field arrives first and the old one leaves last.**

Spec: `docs/EDIT_STATION_TOOL_PACK_CHANGES.spec.md`. Discovery: `docs/EDIT_STATION_TOOL_PACK_CHANGES.discovery.md`. Issue: #1052. Builds on #674 (attachment changes) and #1043 (the dialog's opened-on record).

5 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/1052-edit-station-tool-pack-changes`** — one bug, one PR.

Run tests from each package, limited to the files a slice touches:

```bash
cd packages/core && npm run test:unit -- --testPathPattern station.contract
cd apps/api && npm run test:integration -- --testPathPattern '<file>'
cd apps/web && npm run test:unit -- --testPathPattern EditStationDialog
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` in the packages touched; (5) next slice.

Sequencing rationale:

- **1 (contract adds the field)** is a leaf; everything else types against it. `toolPacks` stays for now, so the API and web still compile.
- **2 (repository)** is pure storage and needs nothing from the route.
- **3 (route)** needs 1 and 2. The old `toolPacks` path keeps working beside it, so the unchanged dialog still saves.
- **4 (dialog)** needs the route to accept what it will send.
- **5 (remove `toolPacks` from update)** can only land once nothing sends it.

---

## Slice 1 — the contract gains `toolPackChanges`

`UpdateStationBodySchema` accepts `toolPackChanges`. Nothing reads it yet.

**Files**

- Edit: `packages/core/src/contracts/station.contract.ts` — add the field; widen `StationAttachmentChangesSchema`'s comment to cover packs.
- Edit: `packages/core/src/__tests__/contracts/station.contract.test.ts`.

**Steps**

1. **Tests (spec: core, all but the `toolPacks`-rejected case).** `toolPackChanges` with `add`, with `remove`, with both; an id in both lists is rejected; an unknown key inside it is rejected; a body with only `toolPackChanges` passes "at least one field". Run; fail.
2. **Implement** the field. Green.
3. Lint + type-check in core; `strict-request-bodies.test.ts` passes; build core so the API and web see the type.

**Done when:** the five cases pass and `npm run type-check` passes in `apps/api` and `apps/web` unchanged.

**Risk:** none.

---

## Slice 2 — `stationToolpacks.applyChanges`

The repository can attach and detach packs against the live rows and report what changed.

**Files**

- Edit: `apps/api/src/db/repositories/station-toolpacks.repository.ts` — `applyChanges(stationId, { add, remove }, actor, client)` → `{ added, removed, remaining }`.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/station-toolpacks.repository.integration.test.ts`.

**Steps**

1. **Tests (spec: api repository, all 7).** Add a built-in and a custom pack; no-ops for an attached add and an unattached remove; soft delete and a new row on re-add; add and remove in one call with `remaining` right, zero included; untouched packs stay; rolls back with its transaction. Run; fail.
2. **Implement.** Read live rows on `client`; insert with `ON CONFLICT DO NOTHING` on each partial unique index, restating `WHERE deleted IS NULL`; soft-delete the removals; return refs as `slug` / `org:<id>`. Green.
3. Lint + type-check in `apps/api`.

**Done when:** the 7 cases pass and the existing `replaceForStation` cases still do.

**Risk:** the `ON CONFLICT` target must restate the partial index's predicate or Postgres won't match it. The "attached add is a no-op" case covers it.

---

## Slice 3 — the route applies `toolPackChanges`

`PATCH /api/stations/:id` handles the new field with every rule in the spec's order table. The old `toolPacks` path is left as it is.

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts` — `STATION_TOOLPACK_REQUIRED`.
- Edit: `apps/api/src/services/station-attachment.service.ts` — `toolPacks` arrays on `StationAttachmentChange`; `applyAll` returns them empty; `hasChanges` counts them.
- Edit: `apps/api/src/routes/station.router.ts` — parse `add` refs, the read check on custom ids, the plan split before the transaction, then inside it after the row update: live packs, the plan refusal, `applyChanges`, the empty-result refusal; audit; `@openapi` text for the new field and codes.
- Edit: `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`.
- Check: `packages/core/src/__tests__/models/audit-log.model.test.ts`, `apps/api/src/__tests__/config/route-authorization.map.ts`.

**Steps**

1. **Tests (spec: api route, all but "`toolPacks` on PATCH is a 400" and the rewrite of existing cases).** By-difference add and remove; two editors; the three plan cases; the four custom-pack cases (owner, member add, member remove skipped, member built-in edit keeps the custom pack); missing and other-organization ids answer like an unreadable one; last pack refused with nothing written, and two concurrent removals; a retired slug in `remove`; audit recorded for a change and not for a no-op. Run; fail.
2. **Implement** in the spec's order. Keep the station row update as the transaction's first statement and read the packs after it; a comment there says it is the lock. Green.
3. Lint + type-check in `apps/api`; run `station-attachments.router.integration.test.ts` and the agent view-attach suite (`curated-view-tools.integration.test.ts`), which read the same audit metadata.

**Done when:** ≈16 new cases pass, and the existing #284, #706 and attachment cases pass unchanged.

**Risk:** the concurrent-removal case depends on the second transaction reading packs after the first commits. If it is flaky rather than failing, the read is in the wrong place, not the test.

---

## Slice 4 — the dialog sends the difference and keeps packs it can't show

**Files**

- Edit: `apps/web/src/components/EditStationDialog.component.tsx` — merge packs with no option back in on change; `toolPackChanges` from `attachmentChanges` over shown packs at save; the count line once the custom list has settled.
- Edit: `apps/web/src/__tests__/EditStationDialog.test.tsx`.

**Steps**

1. **Tests (spec: web, all 12).** Add, remove and both as `toolPackChanges`; remove-and-re-add sends nothing; custom list refused, loading, and loaded; the count line in its three states; the #1043 pack cases on the new field; last shown pack removable while a hidden one remains, and the "at least one" error when none remain; axe with the count line. Existing cases that assert a `toolPacks` body are moved onto `toolPackChanges`. Run; fail.
2. **Implement.** Green.
3. Lint + type-check in `apps/web`; run `dialog-contract.guard` and `component-axe.guard`.

**Done when:** the dialog's suite passes and no web source sets `toolPacks` on an update body.

**Risk:** the SDK's `toolpacks.list` mock in this suite. The refused and loading states need it to stay unresolved or to reject; check how the suite mocks it before writing the cases.

---

## Slice 5 — `toolPacks` leaves the update body

**Files**

- Edit: `packages/core/src/contracts/station.contract.ts` — remove `toolPacks` from `UpdateStationBodySchema`.
- Edit: `packages/core/src/__tests__/contracts/station.contract.test.ts`.
- Edit: `apps/api/src/routes/station.router.ts` — delete the update handler's `toolPacks` branch and its out-of-transaction read; `parseToolpackRefs` and `denyUnentitledBuiltins` stay for create; `@openapi` text.
- Edit: `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`.

**Steps**

1. **Tests.** Core: `toolPacks` on an update is rejected as an unknown key. Route: `toolPacks` on PATCH is `400 STATION_INVALID_PAYLOAD` naming the key. Rewrite the existing #284 and #706 PATCH cases onto `toolPackChanges` (diff the test names before and after: none may disappear). Run; the two new cases fail.
2. **Implement** the removal. Green.
3. `npm run build`, `npm run type-check` and `npm run lint` from the repo root: a contract change reaches typed fixtures in other packages.

**Done when:** the full touched suites pass (core contract, repository, route, attachments route, dialog) and nothing in the repo references `toolPacks` on an update.

**Risk:** a fixture or story still building an update body with `toolPacks`. The root type-check finds it.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `toolPackChanges` on the contract | core contract tests; API and web still type-check |
| 2 | `applyChanges` | repository integration tests |
| 3 | Route rules, new code, audit arrays | route integration tests; attachment and agent suites unchanged |
| 4 | Dialog difference, hidden packs, count line | dialog unit tests and guards |
| 5 | `toolPacks` removed from update | root build, type-check and lint; rewritten cases |

## Cross-slice notes

- **Core rebuilds.** After slices 1 and 5, rebuild core before running API or web checks, and touch an API source file if a dev server is running, or it keeps the old contract.
- **Between slices 3 and 5 the route accepts both fields.** That state is never released; slice 5 ends it. No test covers a body carrying both.
- **No new test files**, so `durations.json` and the shard plan don't change.
- **Docs.** The OpenAPI text changes in slices 3 and 5. No durable doc, Help entry or tool description mentions `toolPacks` on an update (checked in the spec).
- **Review chain.** A full bug: code review, security review (this changes an authorization check), smoke and adversarial are all required. The smoke's centre is a member editing built-in packs on a station with a custom pack; the adversarial list covers unreadable and other-organization ids, both lists naming one id, emptying a station from two sessions, and `toolPacks` on PATCH.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once this plan is confirmed.
