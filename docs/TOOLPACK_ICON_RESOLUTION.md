# Toolpack icon resolution — Condensed design (#302)

**Issue:** [EnterpriseBT/portal-ai#302](https://github.com/EnterpriseBT/portal-ai/issues/302) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The `visualize` pack renders `ExtensionOutlined` — the puzzle piece that means "custom, org-registered" — because web's icon map has no `visualize` key and `getIcon` falls through to that component. The single wrong icon sits on a drift class: every pack *declares* an `iconSlug` that nothing renders, so the declared and rendered icons diverge freely (three packs are silently diverged today). Fix is to make `iconSlug` the thing that renders, and to guard the class. Touches `apps/web` + `packages/core`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Icon map (slug-keyed) | `apps/web/src/utils/tool-pack-icons.util.ts:16-23` | six built-ins; **no `visualize`** |
| Fallback = custom icon | same file, `:31-42` | `getIcon`'s `?? ExtensionOutlined` is the same component `getCustomIcon()` returns |
| Label resolution (**the precedent**) | `apps/web/src/utils/tool-packs.util.ts:22-33` | `getLabel(pack: string)` resolves a bare ref via `isBuiltinToolpackSlug` → `BUILTIN_TOOLPACK_BY_SLUG` → `org:` → raw fallback |
| Chip render site | `apps/web/src/components/ToolPackChip.component.tsx:43` | receives only `pack: string`, so resolution must stay **inside** the util |
| Picker render site | `apps/web/src/components/EditStationDialog.component.tsx:6,39` | already imports `BUILTIN_TOOLPACKS` from core |
| `iconSlug` produced, never rendered | `apps/api/src/routes/toolpacks.router.ts:54` (built-in), `:66` (custom, hardcoded `"Extension"`) | ships over the wire; no UI reads it |
| Declared vs rendered | `packages/core/src/registries/builtin-toolpacks.ts:226,448,689,713` | `visualize` `InsertChart`→**Extension fallback**; `financial` `AccountBalance`→`Paid`; `web_search` `Search`→`TravelExplore`; `entity_management` `Edit`→`Hub` |
| Existing coverage | `apps/web/src/__tests__/ToolPackIconUtil.test.ts:12-46` | pins each pack **by hand** and pins the fallback — the hand list is why #269's omission passed CI |
| Other icon registry | `packages/core/src/ui/Icon.tsx:53` (`IconName` enum + switch) | general UI, **filled** variants, contains **none** of the seven pack chart icons |

Custom packs' `"Extension"` is server-hardcoded and not user-settable, so `iconSlug` is already an authoritative description of the intended icon for *every* pack, both kinds.

## Decision — resolve from `iconSlug` through a web-local map

**A. Web-local map keyed by `iconSlug`, lookup inside the util (chosen).** `getIcon(pack)` mirrors `getLabel` exactly: built-in slug → `BUILTIN_TOOLPACK_BY_SLUG[pack].iconSlug`, `org:` → `"Extension"`, then one `Record<string, SvgIconComponent>` maps the slug string to the component. No call-site signature changes; the outlined variants stay; core stays the source of truth for *which* icon.

**B. Route through core's `IconName` enum (rejected).** Would mean adding seven filled MUI icons to `Icon.tsx`'s enum + switch and restyling every pack chip from outlined to filled — churn in a shared component for no gain. `IconName` serves general UI; pack chips are a separate visual family.

**C. Just add the missing `visualize` key (rejected).** Fixes the symptom in one line and leaves the drift class intact — the next pack added repeats #269 verbatim.

**Mismatch direction:** core's *strings* are corrected to match the components rendered today — never the reverse. Adopting the declared slugs would regress the UI, turning `entity_management`'s network graph into a pencil (`Edit`) and `web_search`'s globe-and-magnifier into a plain magnifier (`Search`). Those three were filed as invisible, so fixing them must stay invisible. `visualize` is the one intended visual change: `AutoGraphOutlined`, which reads as "generated chart" (matching the AI-generated D3 render) and stays distinct from `statistics`' `BarChartOutlined`.

## Plan — one slice

**Files**
- Edit `apps/web/src/utils/tool-pack-icons.util.ts` — replace the slug-keyed `TOOL_PACK_ICONS` with an `iconSlug`-keyed map (`Storage`, `AutoGraph`, `BarChart`, `TrendingUp`, `Paid`, `TravelExplore`, `Hub`, `Extension`); `getIcon` resolves ref → `iconSlug` → component, mirroring `ToolPackUtil.getLabel`; `getCustomIcon()` stays, now returning the `"Extension"` entry by declaration rather than by fallthrough. Add the `AutoGraphOutlined` import.
- Edit `packages/core/src/registries/builtin-toolpacks.ts` — four `iconSlug` strings: `visualize` → `"AutoGraph"`, `financial` → `"Paid"`, `web_search` → `"TravelExplore"`, `entity_management` → `"Hub"`.
- Edit `apps/web/jest.config.js` — add `^@portalai/core/registries$` → core **source** to `moduleNameMapper`. Discovered during implementation and load-bearing: `registries` was the one core subpath not mapped, so web tests resolved it through package `exports` to `packages/core/dist/`. The guard below asserts the icon map covers the registry, which is meaningless against a stale build — and would have passed while source and map disagreed. `ui`/`models`/`contracts` are already mapped this way.

**Tests**
- Edit `apps/web/src/__tests__/ToolPackIconUtil.test.ts` — add `visualize` → `AutoGraphOutlined`; **replace the hand-enumerated distinctness test with a registry-derived guard** iterating `BUILTIN_TOOLPACKS`: every pack's `iconSlug` has a mapped component, no built-in resolves to `ExtensionOutlined`, all built-in icons distinct. This is the assertion that would have failed on #269.
- Edit `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts` — pin `iconSlug: "AutoGraph"` in the existing `visualize pack (#269)` block (`:146-166`).
- Unchanged by design: `ToolPackChip.test.tsx`'s fallback cases assert unknown / `org:` refs, which still resolve to the puzzle piece.
- `npm run test:unit` (web + core), `npm run type-check`, `npm run lint`, `npm run format:check`.

**Doc-sync check (CLAUDE.md standing rule):** no user- or developer-facing surface describes pack icons — not `glossary.util.ts`, `faq.util.ts`, nor `CUSTOM_TOOLPACK_INTEGRATION.md` (it documents the wire/capability contract, not iconography). Nothing to update beyond this doc.

## Smoke (manual, against your dev stack)

0. **Restart `npm run dev` first.** Nothing aliases `@portalai/core` to source for Vite, so the app reads `packages/core/dist/` — an already-running dev server serves the *old* `iconSlug` values and Visualize will still show a puzzle piece. `dev` dependsOn `^build`, so a fresh start rebuilds core; a running one does not.
1. Open a station's Edit dialog → toolpack picker: **Visualize** shows the rising-line-with-sparkles icon, distinct from Statistics' bar chart and from any custom pack's puzzle piece.
2. Same picker: Data Query, Statistics, Regression, Financial, Web Search, and Entity Management look **exactly as before** — in particular Entity Management is still a network graph (not a pencil) and Web Search is still a globe-with-magnifier (not a plain magnifier).
3. Register (or open) a custom toolpack → its chip still shows the puzzle piece.
4. Create Station dialog → the pack chips match the Edit dialog for every pack, built-in and custom.
5. A station carrying a pack the org's tier excludes still renders muted with its correct icon (#284 treatment intact).

## Out of scope

- The puzzle piece on the **Toolpacks page header** (`Toolpacks.view.tsx:328`) and the sidebar nav item (`SidebarNav.component.tsx:219`) — those are section icons for the Toolpacks *area*, not per-pack icons, and are correct as-is.
- Per-pack custom icons for org-registered toolpacks (an icon picker in `RegisterToolpackDialog`). Custom packs are deliberately uniform; that's a product decision.
- Re-theming the other five built-in icons — this change is a visual no-op for them.
- Collapsing web's pack-icon map into core's `IconName` registry (option B) — rejected above, not deferred.
