# Custom Toolpack Registration — Phase 3 — Plan

**Wire the metadata modal into the chip click on station detail and portal session.**

Spec: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_3.spec.md`. Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`. Phase 2: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.{spec,plan}.md`.

Phase 3 is a single substantive PR. The implementation is small enough that a single slice covers it, but the TDD discipline still applies: write the failing tests first, then the wrapper.

Run tests with the project's npm scripts:

```bash
cd apps/web && npm run test:unit
```

---

## Slice 1 — `ToolPackChipWithMetadata` + call-site swap

The whole phase. Lands as one PR.

**Files**

- New: `apps/web/src/components/ToolPackChipWithMetadata.component.tsx`
- New: `apps/web/src/__tests__/ToolPackChipWithMetadataUI.test.tsx`
- New: `apps/web/src/__tests__/ToolPackChipWithMetadata.test.tsx`
- Edit: `apps/web/src/views/StationDetail.view.tsx` — import + call-site swap.
- Edit: `apps/web/src/views/Portal.view.tsx` — same.

**Steps**

1. **Write the pure-UI test (cases 113–117).** Render `ToolPackChipWithMetadataUI` with synthetic `toolpack` props; assert click handlers fire only when `toolpack` is non-null and the modal renders only when `open` is true. No SDK mock needed — the UI is decoupled.

2. **Write the container test (cases 118–119).** Mock `sdk.toolpacks.list` to return either a `data: undefined` (loading) or a `data: { toolpacks }` payload. Use `jest.unstable_mockModule("../api/sdk", …)` per the existing project pattern (see `EntitiesView.test.tsx`).

   For case 118 (built-in resolves synchronously), assert that even with `data: undefined` the chip is clickable and the modal renders the registry's metadata once clicked. The container's `resolveToolpack` synthesizes the record from `BUILTIN_TOOLPACK_BY_SLUG`.

   For case 119 (custom resolves from the list), seed `data.toolpacks` with one custom record, click, assert the modal opens with the custom record's `name`.

3. **Author the wrapper.** Follow the spec's split:

   - **Helper** `resolveToolpack(pack, listToolpacks)`:
     ```ts
     function resolveToolpack(
       pack: string,
       listToolpacks: Toolpack[]
     ): Toolpack | null {
       if (isBuiltinToolpackSlug(pack)) {
         const reg = BUILTIN_TOOLPACK_BY_SLUG[pack];
         return {
           id: `builtin:${reg.slug}`,
           kind: "builtin",
           slug: reg.slug,
           name: reg.name,
           description: reg.description,
           iconSlug: reg.iconSlug,
           tools: reg.tools,
         };
       }
       if (pack.startsWith("org:")) {
         const id = pack.slice("org:".length);
         return (
           listToolpacks.find((t) => t.kind === "custom" && t.id === id) ??
           null
         );
       }
       return null;
     }
     ```

   - **Pure UI** `ToolPackChipWithMetadataUI`:
     ```tsx
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
     ```

   - **Container** `ToolPackChipWithMetadata` (wraps the SDK + state):
     ```tsx
     export const ToolPackChipWithMetadata: React.FC<{ pack: string }> = ({ pack }) => {
       const [open, setOpen] = useState(false);
       const listResult = sdk.toolpacks.list();
       const toolpack = useMemo(
         () => resolveToolpack(pack, (listResult.data?.toolpacks ?? []) as Toolpack[]),
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

4. **Run the new test files.** Both green.

5. **Swap the two call sites.**

   `StationDetail.view.tsx:211`:
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

   `Portal.view.tsx:193`:
   ```diff
   -              {toolPacks.map((pack) => (
   -                <ToolPackChip key={pack} pack={pack} />
   -              ))}
   +              {toolPacks.map((pack) => (
   +                <ToolPackChipWithMetadata key={pack} pack={pack} />
   +              ))}
   ```

   And the matching imports.

6. **Run the existing test suites for the swapped views.** They render chips with the same labels — assertions don't change. If a test happened to assert the chip's `<Chip>` HTML structure verbatim, the wrapper renders the same chip + an unmounted modal sibling, which keeps the structure intact.

7. **Run the full web test suite + lint + type-check.** Clean.

8. **Manual smoke.** `npm run dev`; visit a station detail page; click a tool-pack chip → modal opens. Visit a portal session; click a chip → modal opens. Try a station with a deleted custom pack reference → chip renders, click is a no-op.

**Done when:** cases 113–119 pass; full web suite + lint + type-check are green; manual smoke confirms the click-to-modal path on both views.

**Risk:** the existing `ToolPackChip` component currently inherits `Chip` props through a passthrough — verify that adding `onClick` and `sx` doesn't conflict with any prop the chip already binds (e.g. `onDelete` in form contexts). Phase 3's call sites don't pass `onDelete`, so the conflict is theoretical.

---

## Sequence summary

| Slice | What lands | Tests added |
|---|---|---|
| 1 | `ToolPackChipWithMetadata` wrapper + call-site swap | 7 |

Single PR. ~7 new test cases.

---

## Cross-slice notes

- **Per-wrapper modal mount.** Each `ToolPackChipWithMetadata` mounts an instance of `ToolpackMetadataModalUI`, but the modal is only visible when `open={true}` — `Dialog` from MUI renders a portal lazily. Performance is bounded by React Query's automatic deduplication of the toolpacks list query.

- **No back-compat for `ToolPackChip`.** The existing component stays intact and is still used on `StationList` and `DefaultStationCard`. Phase 3 doesn't deprecate it; the two variants serve distinct UX needs (browse vs. inspect).

- **Routing untouched.** No new route, no nav entry, no SDK addition.

- **CLAUDE.md compliance.** New file follows the suffix convention (`*.component.tsx`); container + pure-UI split follows the Component File Policy with `<Name>UI` naming. Test files use the existing `await import(...)` ESM pattern.

- **Phase 4 hint.** The deferred items from the discovery's phase 5 ("background refresh, drift detection, tool-name pre-flight in station-edit") become the substance of phase 4 if it lands. None of them are needed to ship phase 3.
