# Settings tab index with hidden tabs — Condensed design (#656)

**Issue:** [EnterpriseBT/portal-ai#656](https://github.com/EnterpriseBT/portal-ai/issues/656) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Settings renders its Members / Activity / Access tabs only when the caller holds the matching capability. The shared `useTabs` hook gives each `Tab` an `id` and `aria-controls` but **no `value`**, so MUI falls back to each tab's *position* among the rendered children. When a middle tab is hidden, every tab after it shifts. A custom author role (`member.role.assign` without `member.invite` / `org.audit.read`) sees Access at position 3. Clicking it emits 3 (Members, which that role can't use), and the guard resets the view to Profile. A `?tab=access` deep link seeds 5, which matches the panel but no rendered tab, hence MUI's "None of the Tabs' children match with 5" warning. Found in the #638 adversarial walk. Packages: `packages/core` (the hook) and `apps/web` (regression test).

## Current shape

| Piece | Location | Note |
|---|---|---|
| `getTabProps(index)` | `packages/core/src/ui/Tabs.tsx:64-67` | returns `{ id, "aria-controls" }`, no `value` |
| `getTabPanelProps(index)` | `Tabs.tsx:69-72` | panels match on the **logical** index |
| Conditional tabs | `apps/web/src/views/Settings.view.tsx:161-167` | Members (3), Activity (4), Access (5) gated on `can(...)` |
| Elevated-tab guard | `Settings.view.tsx:126-143` | resets to 0 when `value` is an elevated tab the caller can't use. Correct once values are logical |
| Deep-link index map | `apps/web/src/utils/routes.util.ts:52-60` | `SETTINGS_TAB_INDEX`. Access = 5, "appended so existing indices stay stable" |
| Other consumers | `Help.view.tsx:238-240`, `Connector.view.tsx:202-203` | render every tab unconditionally, so value == position either way |
| Tests | `packages/core/src/__tests__/ui/Tabs.test.tsx:187` (aria attrs), `apps/web/src/__tests__/SettingsMembersTab.test.tsx` (mocks `useCapabilities` to drive gating) | |

## Decision — give every `Tab` its logical value in the shared hook

- **A. Fix `getTabProps` in core:** return `value: index` alongside `id` / `aria-controls`. Every `Tab` then carries its logical index, so MUI's click value, the panel match and `SETTINGS_TAB_INDEX` all agree however many siblings are hidden.
- **B. Fix only Settings:** pass `value={n}` explicitly at the three conditional call sites. That works, but it leaves the trap in the hook for the next view that hides a tab. The hook already claims to own tab wiring, and `getTabPanelProps` already uses logical indices.

**Decision: A.** It's one line, it fixes the whole class of bug, and it's behaviour-preserving for Help and Connector (their positions already equal their indices). This is not a contract change: `getTabProps` gains a field, and MUI `Tab` accepts `value`.

## Plan — one slice

**Files**
- Edit: `packages/core/src/ui/Tabs.tsx`: `getTabProps` returns `{ id, "aria-controls", value: index }`, with a one-line comment saying why (hidden siblings shift MUI's positional fallback).

**Tests** (written first)
- `packages/core/src/__tests__/ui/Tabs.test.tsx`: render three tabs with the middle one conditionally absent (`getTabProps(0)`, `getTabProps(2)`). Clicking the second **rendered** tab shows panel 2 and marks it `aria-selected`. Also extend the aria test to cover the `value` wiring.
- New: `apps/web/src/__tests__/SettingsTabIndex.test.tsx`, reusing the `SettingsMembersTab` mocking pattern. Mock `useCapabilities` with `can` true **only** for `member.role.assign`.
  - Clicking **Access** marks the Access tab `aria-selected="true"` and `tabpanel-5` visible; the view doesn't reset to Profile.
  - `?tab=access` selects Access on mount.
  - An owner (all capabilities) clicking Activity / Access still lands on the right tab (no regression).
- Run `npm run test:unit` (core, then web `--testPathPattern "Tabs|Settings"`), rebuild core, then `npm run type-check`, `npm run lint`, `npm run format:check`.

## Smoke (manual, against your dev stack)

1. As owner, create a custom role with a policy of `allow manage member` + class-level `allow view page`, and give it to a test member (`e2e-member`).
2. As that member, open **Settings** and click **Access**. Access opens (Policies / Roles / Groups, **New policy**), and stays open.
3. Reload `/settings?tab=access` as the member. Access is selected, and the console shows **no** "value provided to the Tabs component is invalid" error.
4. As owner, click through every Settings tab (Profile → Access). Each opens its own panel (no regression when nothing is hidden).
5. Help (Getting Started / Glossary / FAQ) and Connectors (Connected / Catalog) tabs still switch normally.
6. Cleanup: remove the custom role from the member, then delete the role and its policy.

## Out of scope

- Reworking Settings' elevated-tab guard or the `?tab=` read-once seeding (#284). Both are correct once values are logical.
- URL-synced tabs for Settings (the Help-style two-way shape). This is a separate decision.
