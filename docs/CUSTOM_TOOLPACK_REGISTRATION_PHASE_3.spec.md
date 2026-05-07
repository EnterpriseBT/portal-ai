# Custom Toolpack Registration — Phase 3 — Spec

**Make `ToolPackChip` clickable on the station-detail page and inside a portal session, opening the same metadata modal that the `/toolpacks` row click already opens.** Phase 3 is the user-facing polish: it adds no API surface, no schema, no executor change. It only wires the existing `ToolpackMetadataModalUI` (phase 1) into the two chip-render sites that didn't get it in phase 1.

Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`. Phase 2: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.{spec,plan}.md`.

After phase 2, the `/toolpacks` page renders both built-in and custom packs and clicking a row opens the metadata modal. But the same chips on `StationDetail.view.tsx` and `Portal.view.tsx` are still read-only — clicking them does nothing. Phase 3 closes that gap.

Decision points specific to phase 3 (P-3.1–P-3.4):

- **P-3.1 (modal ownership):** each chip wrapper mounts its own copy of the metadata modal, sharing the toolpacks list query via React Query's automatic deduplication. No provider, no context. Multiple wrappers on the page never open simultaneously because the modal state is local; click closes any other open modal naturally because React state on a different mount stays unaffected. Recommended over a top-level provider for v1: simpler and aligns with the pattern used by other on-the-fly modal triggers in the codebase (e.g. `EditFieldMappingDialog`).
- **P-3.2 (unresolvable refs):** a chip whose pack ref doesn't resolve in the list query (e.g. a station with a stale `org:<id>` for a deleted custom pack) renders as a normal chip but is non-clickable. The modal does not open. v1 ships no broken-ref styling — the slug just renders verbatim, matching the existing fallback in `ToolPackUtil.getLabel`.
- **P-3.3 (`ToolPackChip` vs. wrapper):** keep both. The wrapper (`ToolPackChipWithMetadata`) is the new clickable variant for *inspection sites* (station detail, portal session). The plain chip (`ToolPackChip`) stays on *list-preview* surfaces (`StationList`, `DefaultStationCard`) where opening a modal mid-scroll would be the wrong UX. Call-site authors choose the right one.
- **P-3.4 (loading state):** while `sdk.toolpacks.list()` is in-flight, the wrapper renders the chip as non-clickable. Once data arrives, the cursor becomes a pointer and click opens the modal. No spinner — the latency is bounded by the list endpoint's cache hit rate, which is high after the first render.

After this phase: clicking a tool-pack chip on either the station-detail page or inside a portal session opens the same metadata modal that already lives on the `/toolpacks` page. No other behaviour changes.

---

## Scope

### In scope

1. **`ToolPackChipWithMetadata` component** — a new wrapper that:
   - Renders a `ToolPackChip` for the supplied pack ref.
   - Loads `sdk.toolpacks.list()` (kind-merged, cached by React Query).
   - Resolves built-in slugs via the in-memory registry; resolves `org:<uuid>` refs against the list payload.
   - On click of a resolved chip, opens an internal `ToolpackMetadataModalUI` showing the pack's record.
   - On unresolved or still-loading state, renders a normal non-clickable chip.
2. **`ToolPackChip` `onClick` prop** — the existing component already accepts arbitrary `Chip` props through its passthrough; phase 3 documents and tests the click affordance (cursor + hover) when an `onClick` is provided.
3. **Two trigger sites swap to the wrapper:**
   - `apps/web/src/views/StationDetail.view.tsx:211–212` — the `MetadataList` Tool Packs row.
   - `apps/web/src/views/Portal.view.tsx:193–194` — the portal session's chip stack.
4. **Tests for the wrapper** — render-with-builtin-ref, render-with-custom-ref, click-opens-modal, close-button-closes-modal, unresolvable-ref-no-click, loading-state-no-click.

### Out of scope

- Replacing `ToolPackChip` on `StationList.component.tsx` or `DefaultStationCard.component.tsx`. Those are list-preview surfaces; clicking a chip mid-scroll to open a metadata modal is the wrong UX.
- Replacing the row-click handler on `Toolpacks.view.tsx`. That code path already opens the modal in phase 1.
- Any new SDK call. The wrapper reuses `sdk.toolpacks.list()` from phase 1.
- Any new test fixture for the metadata modal itself. The modal's tests stayed green through phase 2; phase 3 doesn't change the modal.
- Loading spinner UX. P-3.4 ratifies "non-clickable while loading, no spinner".
- A top-level toolpacks-context provider. P-3.1 ratifies per-wrapper modal ownership.

---

## Surface

### `ToolPackChipWithMetadata`

**File: `apps/web/src/components/ToolPackChipWithMetadata.component.tsx`** (new)

Pure-UI / container split per the project's Component File Policy. The pure UI accepts the `toolpack` (or `null`) and the modal state; the container wraps it with the SDK call.

```tsx
export interface ToolPackChipWithMetadataUIProps {
  /** The pack reference to render. Built-in slug or "org:<uuid>". */
  pack: string;
  /** Resolved toolpack record, or null if unresolved/loading. */
  toolpack: Toolpack | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export const ToolPackChipWithMetadataUI: React.FC<…> = ({
  pack, toolpack, open, onOpen, onClose,
}) => {
  const clickable = toolpack !== null;
  return (
    <>
      <ToolPackChip
        pack={pack}
        onClick={clickable ? onOpen : undefined}
        sx={clickable ? { cursor: "pointer" } : undefined}
      />
      <ToolpackMetadataModalUI
        toolpack={toolpack}
        open={open}
        onClose={onClose}
      />
    </>
  );
};

export const ToolPackChipWithMetadata: React.FC<{ pack: string }> = ({ pack }) => {
  const [open, setOpen] = useState(false);
  const listResult = sdk.toolpacks.list();
  const toolpack = useMemo(
    () => resolveToolpack(pack, listResult.data?.toolpacks ?? []),
    [pack, listResult.data]
  );
  return (
    <ToolPackChipWithMetadataUI
      pack={pack}
      toolpack={toolpack}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    />
  );
};
```

`resolveToolpack(pack, list)` is a small helper:

- If `pack` is a built-in slug (per `isBuiltinToolpackSlug`): synthesise the `Toolpack` record from the in-memory registry (the same `toBuiltinApiRecord`-style mapping the API uses, factored into a shared helper or duplicated here).
- Else if `pack.startsWith("org:")`: take the `<uuid>` and look up the matching custom record in the list payload.
- Else: `null`.

The synthesis path matters because the list query may not have rendered yet — built-in chips can resolve immediately from the registry without waiting on the network. Custom chips must wait for the list response.

### Call-site swaps

**`apps/web/src/views/StationDetail.view.tsx:211–212`**

```diff
-                                {(station.enabledToolpacks ?? []).map(
-                                  (pack: string) => (
-                                    <ToolPackChip key={pack} pack={pack} />
-                                  )
-                                )}
+                                {(station.enabledToolpacks ?? []).map(
+                                  (pack: string) => (
+                                    <ToolPackChipWithMetadata key={pack} pack={pack} />
+                                  )
+                                )}
```

**`apps/web/src/views/Portal.view.tsx:193–194`** — same swap inside the chip stack.

The import on each file changes from `ToolPackChip` to `ToolPackChipWithMetadata`.

---

## TDD test plan

Numbered against phase 2's continuation (cases 113–119).

### `ToolPackChipWithMetadataUI.test.tsx` (new pure-UI test file)

113. **Renders the chip and no open modal when the modal `open` prop is `false`.**
114. **Renders the modal with the toolpack content when `open` is `true` and `toolpack` is non-null.**
115. **Calls `onOpen` when the chip is clicked and `toolpack` is non-null.**
116. **Does not call `onOpen` when `toolpack` is `null` (loading or unresolved).**
117. **Calls `onClose` when the modal's close button is clicked.**

### `ToolPackChipWithMetadata.test.tsx` (new container test file)

118. **A built-in pack ref resolves synchronously from the registry; clicking opens the modal with the registry's metadata** (mock `sdk.toolpacks.list` so the list isn't strictly required for this case — the container should still render with `data` undefined and resolve the built-in synchronously).
119. **An `org:<uuid>` ref resolves from the mocked list payload; clicking opens the modal with the custom pack's metadata.**

### Integration smoke

The existing `StationDetail` and `Portal` view tests already render chips; updating them is a one-line import swap. No assertion changes — the chip still renders the same label and icon.

---

## Acceptance criteria

- [ ] Cases 113–119 pass.
- [ ] `cd apps/web && npm run test:unit` is green; existing 2090+ tests stay green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] Manual smoke (dev server): open a station detail page; click a tool-pack chip; modal opens with the pack's metadata. Open a portal session; click a chip; modal opens. Both built-in slugs and `org:<id>` refs work.
- [ ] A station with a stale `org:<id>` reference (e.g. enable a custom pack, then soft-delete the pack via the API) renders the chip but the chip is non-clickable; the modal does not open.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Each chip mounts its own `useAuthQuery` for the toolpacks list — perf concern. | React Query dedupes by key — N chips → 1 network request. Verified by inspecting the network tab in dev. |
| The wrapper's `ToolpackMetadataModalUI` flickers on first paint while the list query loads. | The chip renders immediately (non-clickable) without the modal. The modal is mounted but `open={false}` until click; first click after data lands opens it instantly because the toolpack is already resolved. |
| A future feature lands a chip on a third surface and forgets to swap to the wrapper. | The bare `ToolPackChip` remains supported for read-only contexts; phase 3's swap is opt-in by call site, not enforced by the type system. The component-file CLAUDE.md guidance covers the ergonomics. |
| Stale `org:<id>` references render as raw UUIDs, confusing users. | `ToolPackUtil.getLabel` already falls back to the raw ref. v1 does not add broken-ref styling — confirmed by P-3.2. A follow-up could badge unresolved refs with a warning icon. |

**Rollback** is a single revert of the slice: swap `ToolPackChipWithMetadata` back to `ToolPackChip` on the two call sites. The new component file can stay in the codebase unused, or be removed; nothing else depends on it.

---

## Files touched

- New: `apps/web/src/components/ToolPackChipWithMetadata.component.tsx`
- New: `apps/web/src/__tests__/ToolPackChipWithMetadata.test.tsx`
- New: `apps/web/src/__tests__/ToolPackChipWithMetadataUI.test.tsx`
- Edit: `apps/web/src/views/StationDetail.view.tsx` — import + call-site swap.
- Edit: `apps/web/src/views/Portal.view.tsx` — same.

No core, API, or schema changes. No dependency change. No env-var change. No migration.
