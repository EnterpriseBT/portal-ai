# Built-in toolpack entitlement surfacing — Discovery

**Issue:** [EnterpriseBT/portal-ai#284](https://github.com/EnterpriseBT/portal-ai/issues/284) · **Branch:** `feat/builtin-toolpack-entitlement-surfacing` → `main`

**Why this exists.** #214 shipped tier entitlements as a *mechanism*: `TierPolicy.entitlements` carries `builtinToolpacks: string[]` + `customToolpacks: boolean`, `ToolService.buildAnalyticsTools` enforces both, and the web surfaces the custom axis (disabled Register button, "Inactive on your plan" badge). The **built-in** axis got the enforcement and none of the surfacing. The result is a silent state: a station can be configured with `entity_management` on a `standard`-tier org — the picker offers it, the routes persist it, `/toolpacks` lists it as ordinary, four chip surfaces render it as attached — and then `builtinSlugs.filter((s) => entitledBuiltins.has(s))` (`apps/api/src/services/tools.service.ts:445`) deletes it from reality. The agent, asked to create entities, correctly reports it has no such tool, and the user reads a product gap where a plan limit exists.

Worse than invisible: `buildStationContext` feeds the system prompt the station's **configured** packs (`apps/api/src/services/portal.service.ts:1016-1046`), and the prompt's per-pack capability sections gate on `stationContext.toolPacks.includes(...)` (`apps/api/src/prompts/system.prompt.ts:144, 221-222, 322, 393, 440`). So the prompt actively describes tools that were stripped from the same session — the agent is told it can write entities and handed no tool to do it with. And that is only the *gated* prose: four of the seven packs are never gated at all, and the prompt's cross-cutting sections name charts, forecasts, regressions and specific tools unconditionally (D8). This ticket is the surfacing half of #214: make the existing entitlement split legible at every surface that can show it, close the write path that lets the inconsistent state be created, and stop lying to the agent.

## The current shape

### Entitlements: one contract, one server reader, one client reader

| Piece | Location | Note |
|---|---|---|
| Entitlements shape | `packages/core/src/models/tier.model.ts:70-74` | `builtinToolpacks: string[]` + `customToolpacks: boolean`; on `TierPolicySchema` at `:92`. |
| Catalog values | `packages/core/src/registries/tier-catalog.ts:84` / `:104` / `:130` / `:152` | `standard` = `["data_query","web_search"]`; `plus` partial; `pro`/`enterprise` all slugs. |
| Slug registry | `packages/core/src/registries/builtin-toolpacks.ts` | `BuiltinToolpackSlugSchema` (7 slugs), `BUILTIN_TOOLPACKS`, `BUILTIN_TOOLPACK_BY_SLUG`, `isBuiltinToolpackSlug`. |
| Client transport | `apps/api/src/routes/organization.router.ts:576-630` → `apps/web/src/api/organizations.api.ts:25-31` | `GET /api/organization/usage` returns the whole `TierPolicy`; `sdk.organizations.usage()`, keyed `queryKeys.organizations.usage()`. **No new endpoint needed.** |
| Server reader | `tools.service.ts:431` | The *only* server read of `builtinToolpacks` today. |
| Client readers | `Toolpacks.view.tsx:367`, `Settings.view.tsx:90`, `SubscriptionBilling.component.tsx:214`, `Portal.view.tsx:146` | Only `TierCard.component.tsx:115` renders built-in slugs, via `entitlementPackNames()` (`apps/web/src/utils/tier-format.util.ts:78`) — the one existing slug→label entitlement formatter. |

### The stripping site and the fallback to preserve

`buildAnalyticsTools` (`tools.service.ts:387`) loads station rows (`:409`), throws "Station must have at least one tool pack enabled" at `:415-417` keyed off **configuration** (pre-filter, so it survives full stripping), resolves the policy at `:429-443`, strips at `:445`, and builds `enabledPacks` at `:449`. Comments at `:424-427` explicitly bless "every configured pack unentitled ⇒ system tools only, no throw" — the behavior the ticket requires be preserved. `listBulkDispatchTools` (`:229-246`) re-enters the same builder, so it inherits the filter for free.

### The write path

`parseToolpackRefs` (`apps/api/src/routes/station.router.ts:34-64`) is a **sync, pure** splitter: built-in slugs via `isBuiltinToolpackSlug`, `org:<uuid>` custom ids verified in-org; unknown → 400 `STATION_INVALID_TOOLPACK`. It validates *known*, never *entitled*. POST at `:365-415` defaults to `["data_query"]` then `stationToolpacks.replaceForStation` (`:408`). PATCH at `:545-612` fetches the station at `:563` but **never reads existing toolpack rows** — the "newly added only" rule needs `stationToolpacks.findByStationId(id)`, the same call GET already makes at `:270`. Persistence is a soft-delete diff (`station-toolpacks.repository.ts:68-110`). No station route returns 403 today; the model is `toolpacks.router.ts:311-328` (gate + 403) with `TOOLPACK_NOT_ENTITLED` at `api-codes.constants.ts:240` in the toolpack block (`:224-241`).

### The seven display surfaces

| Surface | Location | Shape today |
|---|---|---|
| Create picker | `CreateStationDialog.component.tsx:28`, options rendered `:203-230` | Raw slug strings into an MUI `Autocomplete`; labels via `ToolPackUtil.getLabel`, tags via `ToolPackChip`. |
| Edit picker | `EditStationDialog.component.tsx:32-41`, `:214` | Builds `SelectOption[]` for core `MultiSearchableSelect`. `SelectOption.disabled?: boolean` exists (`packages/core/src/ui/searchable-select/types.ts:6`) but the component passes only a component-level `disabled` (`MultiSearchableSelect.tsx:23`, `:43`) and never `getOptionDisabled` — **per-option disabling is a core-UI gap**. It does own `renderOption` (`:46`), so a reason line has a home. |
| `/toolpacks` rows | `Toolpacks.view.tsx:147-155` | `customToolpacksEntitled` badge, `kind === "custom"` only. |
| Pack modal | `ToolpackMetadataModal.component.tsx:14`, opened at `Toolpacks.view.tsx:343` | Props `{toolpack, open, onClose}` — no entitlement input. |
| Station detail chip | `StationDetail.view.tsx:211` | `ToolPackChipWithMetadata` (`ToolPackChipWithMetadata.component.tsx`, `resolveToolpack` synthesizes built-in records from the registry; UI props `{pack, toolpack, open, onOpen, onClose}`). |
| Portal chip | `Portal.view.tsx:200` | Same component; the view already calls `usage()` at `:146`. |
| List / default-card chips | `StationList.component.tsx:124`, `DefaultStationCard.component.tsx:118` | Bare `ToolPackChip` (`ToolPackChip.component.tsx:21`). Both files already have containers — `StationListConnected` (`:197`) and `DefaultStationCardConnected` (`:141`) — so a prop can be threaded without violating the Component File Policy. |

All four chip surfaces read `station.enabledToolpacks`, assembled server-side at `station.router.ts:269-274`. Shared display helpers are `apps/web/src/utils/tool-packs.util.ts` (`ToolPackUtil.getLabel`) and `tool-pack-icons.util.ts`; neither carries state.

### Upgrade destination

`Settings.view.tsx:108-112` — three tabs, "Subscription & Billing" is index 2, lazily mounted (`tabsProps.value === 2 && <SubscriptionBilling />`, `:332`). Tab state is local via `useTabs(0)` (`packages/core/src/ui/Tabs.tsx:19-50`); the route declares no `validateSearch` and **nothing deep-links the tab today**. The precedent for reading a param on this page is the Stripe `?billing=success|cancelled` effect at `:57-83`. Billing *actions* are owner-only (`SubscriptionBilling.component.tsx:52`, `:279`) while the tab itself is visible to all members — which is why #284's copy is deliberately role-agnostic.

## The design space

### Decision 1 — Where the client learns which built-ins are entitled

- **A — reuse `sdk.organizations.usage()`** in each container, `?? all-slugs` fallback, exactly #214's `?? true` shape (`Toolpacks.view.tsx:367-369`). One react-query cache entry shared by every surface.
- **B — new `GET /api/organization/entitlements`.** A smaller payload for a query that is already cached and already in flight on most of these pages.
- **C — server-decorate the payloads.** Add `entitled: boolean` per entry to `station.router.ts:269-274`'s `enabledToolpacks`, so the four chip surfaces need no query at all.

| | A — reuse `usage()` | B — new endpoint | C — decorate payloads |
|---|---|---|---|
| New contract | none | new route + SDK + key | changes station GET/list/portal responses |
| Covers pickers + `/toolpacks` | yes | yes | **no** (options come from the registry, not a station) |
| Extra fetches | 0 (cached, shared) | 1 per page | 0 |
| #214 symmetry | **exact** | diverges | diverges |

**Lean: A.** C is genuinely tempting for chips, but it can't serve the pickers or the list, so it would ship *two* mechanisms and a multi-endpoint contract change for a query that is already cached on the page. One client-side source keeps the axis symmetric with #214 and leaves every response contract untouched.

### Decision 2 — How the surfaces share the logic

- **A — pure predicate + read hook.** Extend `tool-packs.util.ts` with a pure `isBuiltinPackEntitled(slug, entitledSlugs)` / `unentitledOf(slugs, entitled)`, plus `apps/web/src/utils/use-builtin-entitlements.util.ts` wrapping `usage()` and returning `{ entitledSlugs: Set<string>, isEntitled }`. Containers call the hook, pure UI takes primitives.
- **B — inline in each container.** Seven copies of `usage()?.tier.entitlements.builtinToolpacks ?? …`.
- **C — a React context provider.** Warranted if the value were expensive or deeply threaded; it is neither.

**Lean: A.** The pure predicate is unit-testable with no react-query, matching the house rule that tests drive `*UI` components through props (`Toolpacks.view.test.tsx:236-320` needs no SDK mock). B guarantees drift in the fallback semantics across seven call sites.

### Decision 3 — Picker disabling

Two different widgets. The Create dialog's MUI `Autocomplete` supports `getOptionDisabled` natively. The Edit dialog's core `MultiSearchableSelect` does not thread it (`:23`, `:43`) though `SelectOption.disabled` is already in the type (`types.ts:6`).

- **A — teach `MultiSearchableSelect` to honor `SelectOption.disabled`** (pass `getOptionDisabled`, render the reason in the existing `renderOption` at `:46`), and use `getOptionDisabled` directly in the Create dialog.
- **B — filter unentitled options out of the Edit picker.** Rejected outright: "visible but disabled with a reason" *is* the deliverable; filtering is the current silent behavior in a new place.
- **C — a bespoke web-only multiselect for stations.** Duplicates a core component to avoid a five-line core change.

**Lean: A.** It closes a real core-UI gap (a declared-but-ignored prop is a latent bug for every future consumer) and both pickers end up honoring the same `SelectOption.disabled` + reason contract.

### Decision 4 — How an attached chip reads as inert

- **A — an `entitled?: boolean` (default `true`) prop on `ToolPackChip`,** rendering muted/outlined with a tooltip naming the limit and the upgrade link; `ToolPackChipWithMetadata` forwards it and its modal states the limit.
- **B — a sibling `InertToolPackChip` component.** A second component to keep in visual sync with the first, for a one-axis variation.
- **C — strike-through label only.** No affordance, no reason, no upgrade path — fails the acceptance criteria.

**Lean: A.** One chip, one variant prop, default-`true` so all existing call sites and their tests (`ToolPackChip.test.tsx`, `StationList.test.tsx`, `DefaultStationCard.test.tsx`) stay green until each container opts in.

### Decision 5 — Server enforcement: the "newly added" diff

- **A — reject only slugs not already persisted.** PATCH loads `stationToolpacks.findByStationId(id)`; the guard runs over `payload \ existing`. POST has no existing rows, so every unentitled slug is new.
- **B — reject any unentitled slug in the payload.** Breaks the acceptance criterion that a rename-only PATCH on an already-unentitled station succeeds, and makes a downgrade freeze the station.
- **C — silently drop unentitled slugs on write.** This is the bug, relocated.

**Lean: A**, with the guard as an `async` step **after** `parseToolpackRefs` rather than inside it — the parser stays sync and pure, the guard needs `repo.organizations.findById` + `TierService.resolveTier` (the same pair `tools.service.ts:429-443` uses). New `ApiCode.STATION_TOOLPACK_NOT_ENTITLED` (the toolpack block at `api-codes.constants.ts:224-241`), 403 on both routes, `@openapi` annotated per `toolpacks.router.ts:289`. Note POST's `["data_query"]` default (`:365-415`) sits *inside* the guarded set; that is safe only because every catalog tier entitles `data_query` — pin it with a `tier-catalog.test.ts` invariant rather than leaving it implicit.

### Decision 6 — How the agent distinguishes "no such tool" from "not on your plan"

The prompt bug and the wording requirement have the same root: `buildStationContext` reports *configured* packs.

- **A — split the context.** `StationContext.toolPacks` becomes **effective** packs (configured ∩ entitled) so the capability sections at `system.prompt.ts:144, 221-222, 322, 393, 440` stop describing stripped tools; a new `unentitledToolPacks` drives one short prompt block amending "If no tool fits, say so plainly" (`:86-89`) to name the plan limit and the upgrade path when the missing capability is a stripped pack.
- **B — prompt guidance only,** leaving `toolPacks` as configured. The prompt keeps advertising tools that do not exist; the agent is asked to reason around its own contradictory context.
- **C — `station_context` output only** (`station-context.tool.ts:113`, `StationContextResponse` at `:55`, which carries no pack inventory today). A field the agent must read beats prose it can misread — but only if it looks; the prompt is what fires unprompted.

**Lean: A + C.** Per CLAUDE.md's tool-surface rule, prefer unambiguous **output** over prose alone: add the effective/unentitled pack lists to `StationContextResponse` *and* fix the prompt's source of truth. B alone leaves the contradiction that produced the reported behavior. The prompt pins (`system.prompt.test.ts:112-135`, matrix at `:224-232`) extend to cover effective-vs-configured.

The "no tool fits" guidance (`:86-89`) then distinguishes **three** cases, not two: the capability is effective (call the tool), configured-but-unentitled (name the plan limit, point at the upgrade path), or not configured at all (the station simply doesn't have it — no plan framing, since upgrading wouldn't help).

### Decision 7 — The upgrade link target

- **A — `/settings?tab=billing`,** with `Settings.view.tsx` seeding `useTabs` from the param (precedent: the `?billing=…` reader at `:57-83`).
- **B — plain `/settings`,** leaving the user to find the third tab.

**Lean: A.** A link that names a limit and then drops the user on the General tab is not an upgrade path. One shared constant for the href so all seven surfaces agree.

### Decision 8 — Keeping the agent's self-description honest as entitlements change

The reported symptom — an agent claiming it could visualize on a tier that doesn't entitle `visualize` — is **not** catalog drift. It is that most capability prose in `system.prompt.ts` is ungated. Only three of the seven slugs gate anything (`entity_management` at `:144`/`:393`/`:440`, `data_query` at `:221`, `visualize` at `:222`/`:322`); the rest is unconditional:

- the role intro (`:62-92`) tells the agent its tools "read data, compute results, **render visualizations**, and make changes", and enumerates "a query, a calculation, a **forecast/regression**/aggregate, a **chart**, a record change" — charting, forecasting and regression named on a station holding none of those packs;
- Response Style (`:458-462`) promises the user a feed of "data tables, **charts**, and mutation results";
- the interpretive-output sentence (`:487-492`) names `hypothesis_test` (statistics), `web_search` (web_search) and `resolve_identity` (data_query) by name, unconditionally;
- `statistics`, `regression`, `financial` and `web_search` carry **no gate at all** — they have no section, so their capabilities reach the agent only through the ungated prose above.

- **A — gate the leaks one at a time.** Wrap each fragment in the right `toolPacks.includes(…)`. Fixes today's text; the next added pack, or the next reworded paragraph, silently re-opens the hole and no test fails.
- **B — declare the capability surface per pack, exhaustively.** A `PACK_PROMPT_SECTIONS: Record<BuiltinToolpackSlug, (ctx) => string[]>` in `system.prompt.ts`, exhaustive over the slug union — so adding an eighth slug to `BuiltinToolpackSlugSchema` is a **compile error** until its section is declared (`[]` is a legal, explicit "this pack needs no guidance"). Cross-cutting prose (intro, Response Style, the interpretive-tools sentence) is **assembled** from the effective packs' declared capability phrases instead of hardcoding a list. A guard test over `BuiltinToolpackSlugSchema.options` renders the prompt with each slug in and out of the effective set and asserts that pack's markers appear **iff** it is effective — the same posture as the cost gate's "every tool is wrapped" guard.
- **C — instruct the agent to self-check.** "Only claim capabilities that appear in your tool list." Prose asking the model to distrust the adjacent prose we wrote.

**Lean: B.** Entitlements are the driver and they *will* change — re-tiering `visualize` in `tier-catalog.ts`, or shipping an eighth pack, must change what the agent says it can do with **no prompt edit**. A is a point-in-time fix with no ratchet; C asks the model to police a contradiction we control. B makes "the agent can never claim a capability it doesn't have" structurally enforced: compile-time for registry additions, guard test for gating, entitlement-driven at runtime through D6's effective set. Capability phrases live beside their section in the prompt module — agent-facing wording stays on the agent-facing surface per CLAUDE.md's three-surfaces rule — not in the core registry.

This also answers `visualize` directly: with B a `standard`-tier station never hears about charting, so the reported claim cannot recur. Whether `visualize` *should* be absent from `standard`/`plus` remains product data in `tier-catalog.ts` — confirmed at smoke, not a follow-up ticket.

## Tradeoff comparison

| | D1 reuse `usage()` | D2 predicate + hook | D3 core option-disable | D4 chip variant prop | D5 diff-guard 403 | D6 effective + unentitled | D7 `?tab=billing` | D8 declared pack surface |
|---|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| New endpoint / response change | No | No | No | No | No | No (additive tool output) | No | No |
| Touches `packages/core` | No | No | **Yes** | No | No | No | **Yes** (`Tabs` consumer only) | No (reads the slug union) |
| Writes on tier change | None | None | None | None | None | None | None | None |
| Survives a re-tier / new pack with no prompt edit | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Yes — enforced** |

## Recommendation

1. Entitlements reach the web through the existing `GET /api/organization/usage` → `sdk.organizations.usage()`; no new endpoint, no changed response contract.
2. `apps/web/src/utils/tool-packs.util.ts` gains a pure entitlement predicate; `apps/web/src/utils/use-builtin-entitlements.util.ts` wraps the query and returns the entitled-slug set with a permissive fallback when the query has no data. Containers consume the hook; pure UI components take primitives.
3. `MultiSearchableSelect` honors the already-declared `SelectOption.disabled` (`getOptionDisabled` + a reason line in its existing `renderOption`); both station pickers render unentitled built-ins visible, unselectable, and reasoned.
4. `ToolPackChip` gains `entitled?: boolean` (default `true`) rendering a muted variant with a tooltip that names the limit and links to the upgrade path; `ToolPackChipWithMetadata` forwards it, and its metadata modal states the limit. `StationListConnected`, `DefaultStationCardConnected`, `StationDetail.view`, and `Portal.view` supply it from the hook.
5. `Toolpacks.view` extends its existing badge to built-in rows whose slug is unentitled, and threads the same state into `ToolpackMetadataModal`.
6. Every unentitled affordance links to `/settings?tab=billing` via one shared constant; `Settings.view` seeds its tab from the param. Copy is **role-agnostic** — no surface reads `organization.ownerUserId`.
7. `POST /api/stations` and `PATCH /api/stations/:id` run an async entitlement guard after `parseToolpackRefs`, over **newly added** built-in slugs only (PATCH diffs against `stationToolpacks.findByStationId`), returning `403 STATION_TOOLPACK_NOT_ENTITLED` with an `@openapi`-documented response and a `warn` log carrying org id, tier slug, and denied slugs.
8. `buildStationContext` reports **effective** packs (configured ∩ entitled) plus a new `unentitledToolPacks` list; the system prompt's per-pack sections key off effective packs, and its "no tool fits" guidance gains the three-way branch (effective / unentitled / not configured). `station_context`'s response carries both lists so the agent reads the distinction from a field, not prose.
9. The prompt's capability surface becomes **declared and exhaustive**: a `PACK_PROMPT_SECTIONS: Record<BuiltinToolpackSlug, …>` (a new slug is a compile error until declared), cross-cutting prose assembled from the effective packs' capability phrases rather than hardcoded, every current ungated leak (`:62-92`, `:458-462`, `:487-492`) closed, and a guard test over `BuiltinToolpackSlugSchema.options` asserting each pack's markers appear **iff** the pack is effective. Re-tiering in `tier-catalog.ts` changes what the agent claims with no prompt edit.
10. `tools.service.ts:415-427`'s "all packs unentitled ⇒ system tools only" behavior is preserved and pinned by test; a `tier-catalog.test.ts` invariant asserts every tier entitles `data_query` (POST's default).

## Resolved questions

All six are settled; 1–4 and 6 take the lean as written, 5 is resolved *against* its lean and promoted to Decision 8.

1. **Fallback when `usage()` has no data (loading, error, offline).** **Resolved: fail open** (treat everything entitled), mirroring #214's `?? true` at `Toolpacks.view.tsx:369`. A failed side query must never block a legitimate action; the server guard is the real gate, so the worst case is a 403 the user can read instead of a UI that silently forbids work it can't justify.
2. **Does the guard belong in the router or a service?** There is no `station.service.ts`. **Resolved: a local async helper in `station.router.ts` beside `parseToolpackRefs`,** since both handlers are the only callers; promote it if a third write path appears.
3. **Does `entitlementPackNames()` (`tier-format.util.ts:78`) become the shared formatter?** It formats an entitlement *list* for `TierCard`. **Resolved: leave it; add the per-slug predicate separately** — different question (is *this* slug in the set), and folding both into one util couples the billing card to the station surfaces.
4. **Should the copy name the required tier ("available on Plus")?** **Resolved: no** — hold the issue's line and avoid coupling copy to catalog contents. The catalog already ships per-tier entitlement lists to the billing tab, so the link answers "which plan" one click later.
5. **`visualize` is absent from `standard` *and* `plus` while the reported agent claimed it could visualize.** **Resolved, and reframed: the agent must never be able to claim a capability it does not have, and the live entitlements are the only driver of what it can do *or say*.** "Verify at smoke, file a drift ticket" was the wrong frame — the claim did not come from a stale catalog row, it came from ungated prompt prose (`:62-92`, `:458-462`, `:487-492`) that names charts, forecasts, regressions and specific tools regardless of the effective pack set. Because tier entitlements will keep changing as business needs change, the fix has to be structural rather than a one-time text pass: see **Decision 8** (exhaustive per-pack declaration, assembled cross-cutting prose, iff-effective guard test). The catalog's *contents* stay product data — confirmed at smoke, no follow-up ticket.
6. **Do the prompt pins need per-pack effective-vs-configured cases, or one representative case?** **Resolved: extend the existing `it.each` (`system.prompt.test.ts:112-135`) with a configured-but-unentitled variant for one pack, plus a matrix case** — per-pack duplication buys nothing over the shared code path. Note this is the *effective-vs-configured* pin; D8's separate iff-effective guard does iterate all seven slugs, because there its whole job is to catch the pack nobody remembered to gate.

## Enterprise-scale considerations

- **Concurrency & correctness** — the guard is a check-then-act (resolve tier → write toolpack rows) but the raced outcome is benign and non-monetary: a downgrade landing mid-PATCH leaves a slug that is inert at the next session build, which is exactly the tolerated downgrade state. **Lean: no locking; record the race as accepted,** consistent with #214's register-403 posture.
- **Accuracy & auditability** — no ledger; entitlement is a projection of the tier row, and denials are request-scoped. **Lean: `warn`-log every denial with org id, tier slug, and the denied slugs** so support can answer "why did my station save fail" without reproducing it. Tier-row edit auditing stays deferred to #218's catalog + `portalai` audit trail.
- **Failure modes** — deliberately **split**: the UI fails **open** (OQ1) because a stale side query must not forbid legitimate work; the server guard fails **closed** (no resolvable policy ⇒ no new attach), because a blanket fail-open there would reintroduce exactly the silent state this ticket removes. A DB outage already fails the whole session build, so fail-closed costs nothing it hasn't already lost.
- **Scale & unbounded growth** — cardinality is bounded by the 7-slug registry; `resolveTier` is TTL-cached; the client adds zero fetches (one shared `usage()` cache entry, not one per chip); PATCH adds one indexed `findByStationId` that GET already performs. **N/A beyond that.**
- **Multi-tenancy** — per-org by construction (station → org → tier). Org switching re-keys the `usage()` query, so a member in a `pro` org and a `standard` org sees each org's own truth. No cross-tenant read. **N/A.**
- **Contract stability** — no response contract changes (D1 rejected payload decoration precisely to avoid versioning four endpoints); the `station_context` addition and the `ToolPackChip`/`SelectOption` props are additive with permissive defaults. Per-pack entitlement metadata (required tier, upgrade CTA copy, usage caps) can extend `entitlements` later without re-plumbing these call sites. D8 extends this to the **agent-facing** contract: the prompt's capability surface is keyed off the slug union, so an eighth pack fails the build until it declares its section, and a re-tier in `tier-catalog.ts` propagates to what the agent claims with no code change at all.
- **Data lifecycle** — entitlements are current-state config, not a windowed measure; nothing to retain or roll over. **N/A.**

## What this doesn't decide

- **Which packs each tier entitles.** Product data in `tier-catalog.ts`; this ticket makes the existing split legible and makes every surface — including the agent's own self-description — follow it dynamically, but it does not re-tier anything. `visualize`'s placement on `standard`/`plus` is confirmed at smoke, not changed here (Q5).
- **Retroactively stripping unentitled packs** from existing stations, or any `station_toolpacks` migration. Downgrade stays non-destructive by design, which is what makes the D5 diff necessary.
- **The custom-toolpack axis.** Shipped in #214; only its badge is extended to built-in rows here.
- **A per-pack upgrade or checkout flow.** The link lands on the shipped Subscription & Billing tab; no in-picker purchase, no new page.
- **Server-decorated `entitled` flags** on station/portal payloads (D1 option C) — revisit only if a consumer appears that cannot read `usage()`.
- **Role-differentiated copy.** Deliberately waived: identical for owners and non-owners, since the owner-only gate already lives on the billing tab (`SubscriptionBilling.component.tsx:52`).
- **Naming the required tier in copy.** OQ4 holds the line; a later per-pack entitlement metadata field could revisit it.

## Next step

`docs/BUILTIN_TOOLPACK_ENTITLEMENT_SURFACING.spec.md` pins the contract: the entitlement read + fallback semantics, `SelectOption.disabled` honoring in `MultiSearchableSelect`, the `ToolPackChip.entitled` variant, the badge/modal extension, the shared upgrade href + `?tab=billing`, `STATION_TOOLPACK_NOT_ENTITLED` with its newly-added-only diff rule and 403 annotations, the effective/unentitled `StationContext` + `station_context` output, and D8's declared per-pack prompt surface with its iff-effective guard. Then `docs/BUILTIN_TOOLPACK_ENTITLEMENT_SURFACING.plan.md`, 4 slices on this one branch — no child ticket — each a testable commit:

1. **Core + web plumbing** — `MultiSearchableSelect` option-disable, the pure predicate, the `use-builtin-entitlements` hook, the shared upgrade href, `?tab=billing`.
2. **Display surfaces** — both pickers, `/toolpacks` badge + modal, the four chip surfaces.
3. **Server enforcement** — the async guard, the `ApiCode`, both 403s + `@openapi`, the `data_query` catalog invariant, integration tests on `station.router.integration.test.ts`.
4. **Agent legibility (D6 + D8)** — effective/unentitled `StationContext`, `station_context` output, the three-way "no tool fits" branch, the `PACK_PROMPT_SECTIONS` declaration with every ungated leak closed and cross-cutting prose assembled from effective packs, the iff-effective guard test, and the updated existing pins. Doc-sync rides this slice: `glossary.util.ts` / `faq.util.ts` for the "inactive on your plan" concept, plus the `builtin-toolpacks.ts` mirror if any pack description changes.

Slice 4 is the largest of the four and the one carrying the reported bug's actual fix; it stays in this ticket rather than splitting out, so the surfacing and the agent's honesty ship together.
