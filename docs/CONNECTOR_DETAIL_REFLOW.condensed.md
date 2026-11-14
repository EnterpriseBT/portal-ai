# Connector detail reflow at 320px — Condensed design (#1019)

**Issue:** [EnterpriseBT/portal-ai#1019](https://github.com/EnterpriseBT/portal-ai/issues/1019) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791 (found by #800); branch `fix/1019-connector-detail-reflow` → `epic/a11y-conformance`.

**Why.** At 320 CSS px (WCAG 1.4.10 Reflow), a connector's detail page scrolls sideways: the Config code block is 375px wide, so its copy button sits off-screen, and the Capabilities row runs past the right edge. The fix is two layout rules: one in core's `MetadataList`, which fixes every responsive caller, and one in web's capability-flags row. The ACR's 1.4.10 row moves to Supports in the same PR.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Responsive row | `packages/core/src/ui/MetadataList.tsx:152-171` | On xs the row is a flex **column** with `alignItems: "flex-start"`, so the value box isn't stretched: it takes its content's width. Its `minWidth: 0` (`:166`) can't help, since nothing is squeezing it |
| Wrap-direction item | `MetadataList.tsx:225` | Already `minWidth: 0`; not the cause the issue guessed |
| Config value | `apps/web/src/views/ConnectorInstance.view.tsx:499-506` | `HighlightedCode`: a `pre` with `overflow: auto` (`components/HighlightedCode.component.tsx:132`), which only scrolls once its box is narrower than its lines |
| Capabilities value | `ConnectorInstance.view.tsx:533-554` → `components/ConnectorInstanceCapabilityFlags.component.tsx:76,86` | A `Stack direction="row"` of chips (read-only) or checkbox labels (editable) with no wrap |
| Other callers | 22 web files use `MetadataList`; none uses `layout="inline"` | Every `layout="responsive"` caller gets the fix for free |

## Decision — stretch the value, wrap the flags

- **`MetadataList`:** the value box in `ResponsiveRow` gets `alignSelf: "stretch"`. On xs (column) that gives it the row's width, so `minWidth: 0` and the code block's `overflow: auto` engage. On sm+ (row) it only stretches the height of a box whose width comes from `flex: 1`, which changes nothing visible. Rejected: changing `alignItems` per breakpoint, which also stretches the label and can't be asserted in jsdom (media queries).
- **Capability flags:** both row `Stack`s get `flexWrap="wrap"` and `useFlexGap`. Those are layout props, not ad hoc `sx`. `useFlexGap` keeps the spacing right on wrapped lines, which margin-based `spacing` doesn't.
- **Checked live (2026-11-14, 320×720):** before, `main` was 399/320, the value box 375px inside a 272px column with `align-items: flex-start`, and Push's right edge at 347. With both rules patched into the page: `main` 320/320, the code block 272px and scrolling on its own, the copy button's right edge at 292, and the flags wrapped.
- **ACR:** 1.4.10 moves to Supports, and the audit's RZ row is marked closed by #1019. That's the doc-sync rule for a fix to an issue an ACR row cites.

## Plan — 1 slice

**Files:**
- **Edit:** `packages/core/src/ui/MetadataList.tsx`; `apps/web/src/components/ConnectorInstanceCapabilityFlags.component.tsx`; `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` (the 1.4.10 row; the report date); `docs/A11Y_AUDIT.md` (the RZ row).

**Tests:**
- `packages/core/src/__tests__/ui/MetadataList.test.tsx`: a responsive row's value box has `align-self: stretch` and `min-width: 0`.
- `apps/web/src/__tests__/ConnectorInstanceCapabilityFlags.test.tsx`: both the read-only and editable rows have `flex-wrap: wrap`.
- `npm run test:unit -w @portalai/core -- --testPathPattern MetadataList`; `npm run test:unit -w @portalai/web -- --testPathPattern ConnectorInstanceCapabilityFlags`; `npm run build -w @portalai/core` before web; `npm run lint:doc-pointers`.

## Smoke (manual, against your dev stack)

1. Viewport 320×720 (or 400% zoom at 1280px). Open the fixture's **Demo REST API** connector (`/connectors/5069803d-1ddc-436e-83cf-23ed527e79eb`). `main#main-content` has no horizontal scroll (`scrollWidth === clientWidth`).
2. The Config block is no wider than the page, scrolls sideways on its own, and its copy button is on-screen and focusable.
3. The Capabilities checkboxes wrap onto a second line, and none is cut off. Tab through them; each is visible when focused.
4. As a member without write on the connector (`e2e:use member`): the read-only capability chips wrap too.
5. At 1280px, the connector header looks as before: label and value side by side, with the code block at full width.
6. Spot-check another responsive `MetadataList` at 320px (a station's or an entity's detail header): nothing scrolls sideways.
7. Brand Dark: repeat step 1.

## Out of scope

- Other 1.4.10 or 1.4.12 findings (#1020 card titles), and charts and maps at 320px (not walked; see the ACR).
- `MetadataList`'s `inline` layout, which no caller uses.
