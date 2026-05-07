# Custom Toolpack Registration — Phase 4 — Spec

**Surface tool-name collisions in the station-edit dialog before save, instead of failing only at portal-session start.** The smallest substantive phase: no API change, no schema change, no executor change. A pure-helper detection function plus a warning Alert in two existing dialogs.

Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`. Phase 2: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.{spec,plan}.md`. Phase 3: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_3.{spec,plan}.md`.

After phase 2: every custom toolpack registers, executes, refreshes, and deletes correctly. Schema refresh is **manual** — phase 2's `POST /api/toolpacks/:id/refresh` plus the "Refresh schema" button in `EditToolpackDialog` are the steady-state. No scheduler, no automation; the org admin nudges packs they care about. Phase 4 keeps it that way.

The one remaining rough edge from the discovery's deferred list is **tool-name collisions failing at the wrong time.** The station-edit dialog happily accepts a selection where two toolpacks both define `lookup_company`; the user discovers the conflict only when they open a portal session and see a runtime error. Phase 2's spec D5 said the pre-flight warning was a follow-up — phase 4 is that follow-up.

Resolved decision points specific to phase 4 (P-4.1):

- **P-4.1 (collision behavior in the station dialog):** warn but do not block save. The runtime check in `tools.service.buildAnalyticsTools` already throws a clear error on collision; the dialog's job is to surface the same information earlier so the user can fix it before opening a portal. Blocking save would prevent the user from saving a partial state mid-fix and force them to deselect packs they want to keep — too aggressive. The save button stays enabled; an `<Alert severity="warning">` shows the collision details and explains the consequence ("Portal sessions will fail until this is resolved").

After this phase: a station-edit selection that would shadow a tool name flags itself in the dialog before save, with both pack names and the conflicting tool listed.

---

## Scope

### In scope

1. **Tool-name collision detection helper** — `apps/web/src/utils/toolpack-collisions.util.ts`. Pure function: takes the user's currently-selected `toolPacks: string[]` and the toolpacks list payload, walks each ref's tools (built-in slugs from the in-memory registry; `org:<id>` from the list), and returns `Array<{ toolName: string; ownerLabels: string[] }>` for any tool name appearing in more than one selected pack.
2. **Collision-warning UI in the station dialogs** — `CreateStationDialog.component.tsx` and `EditStationDialog.component.tsx` render a `<Alert severity="warning">` panel below the pack picker when the helper returns a non-empty list. The panel lists each colliding tool name and the packs that contributed it. Save remains enabled (P-4.1).
3. **Tests** for the helper (pure unit) and the dialog warnings (rendering assertions on the shared fixture path established in phase 2 slice 9).

### Out of scope

- Background / scheduled schema refresh. Phase 2's manual refresh is the steady-state — users hit the Refresh button in `EditToolpackDialog` when they need fresh tools. Adding automation would be its own follow-up; this spec doesn't add it.
- A bulk "Refresh all" toolbar button on the `/toolpacks` page. Per-pack refresh is enough at v1 scale.
- Drift detection / ETag checks.
- Blocking the station save on collision. P-4.1.
- Email / Slack notifications when a station is saved with collisions.
- A "refresh now" link in the station-edit collision panel. Out of scope — users can refresh from the toolpacks page.
- Reflecting refresh state in the toolpacks list beyond the existing `lastRefreshed` timestamp.
- Any change to how toolpacks are *registered* or *refreshed*. Phase 2 owns those.
- Any frontend SDK addition. The existing `sdk.toolpacks.list({ kind: "custom" })` call already running inside both dialogs (phase 2 slice 9) provides the data the helper needs.
- Any backend change at all. Phase 4 is web-only.

---

## Surface

### Collision detection helper

**File: `apps/web/src/utils/toolpack-collisions.util.ts`** (new)

```ts
import {
  BUILTIN_TOOLPACK_BY_SLUG,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";
import type { Toolpack } from "@portalai/core/contracts";

export interface ToolpackCollision {
  toolName: string;
  /** Display labels of the packs that each define this tool. */
  ownerLabels: string[];
}

/**
 * Walk the user's selected pack refs and find tool names that
 * appear in more than one pack. Used by station dialogs to warn
 * about collisions before save.
 *
 * - Built-in slugs resolve from the in-memory registry.
 * - `org:<id>` refs look up against the supplied list payload.
 * - Unresolvable refs are skipped silently (the caller's slug
 *   validation handles those).
 */
export function detectToolpackCollisions(
  selectedRefs: string[],
  customs: Toolpack[]
): ToolpackCollision[] {
  const ownersByTool = new Map<string, Set<string>>();
  for (const ref of selectedRefs) {
    const { tools, label } = resolve(ref, customs);
    if (!tools) continue;
    for (const tool of tools) {
      const owners = ownersByTool.get(tool.name) ?? new Set();
      owners.add(label);
      ownersByTool.set(tool.name, owners);
    }
  }
  const collisions: ToolpackCollision[] = [];
  for (const [toolName, owners] of ownersByTool.entries()) {
    if (owners.size > 1) {
      collisions.push({ toolName, ownerLabels: [...owners].sort() });
    }
  }
  return collisions.sort((a, b) => a.toolName.localeCompare(b.toolName));
}

function resolve(
  ref: string,
  customs: Toolpack[]
): { tools: { name: string }[] | null; label: string } {
  if (isBuiltinToolpackSlug(ref)) {
    const reg = BUILTIN_TOOLPACK_BY_SLUG[ref];
    return { tools: reg.tools, label: reg.name };
  }
  if (ref.startsWith("org:")) {
    const id = ref.slice("org:".length);
    const pack = customs.find((t) => t.kind === "custom" && t.id === id);
    if (!pack) return { tools: null, label: ref };
    return { tools: pack.tools, label: pack.name };
  }
  return { tools: null, label: ref };
}
```

### Dialog warning UI

Both `CreateStationDialog.component.tsx` and `EditStationDialog.component.tsx` already load `sdk.toolpacks.list({ kind: "custom" })` (phase 2 slice 9). They get the customs payload for free. The dialogs add:

```tsx
const collisions = useMemo(
  () =>
    detectToolpackCollisions(
      form.toolPacks,
      (customsResult.data?.toolpacks ?? []) as Toolpack[]
    ),
  [form.toolPacks, customsResult.data]
);

// rendered below the pack picker:
{collisions.length > 0 && (
  <Alert severity="warning" data-testid="toolpack-collision-warning">
    <AlertTitle>Tool-name collisions on this station</AlertTitle>
    <Stack spacing={0.5}>
      {collisions.map((c) => (
        <Typography key={c.toolName} variant="body2">
          <code>{c.toolName}</code> is provided by{" "}
          <strong>{c.ownerLabels.join(", ")}</strong>.
        </Typography>
      ))}
    </Stack>
    <Typography variant="caption" color="text.secondary">
      Portal sessions will fail until this is resolved. Save will be allowed
      so you can keep iterating; remove one of the conflicting packs to
      clear the warning.
    </Typography>
  </Alert>
)}
```

Save button is unchanged — no disabled state added by phase 4.

---

## TDD test plan

Cases 120–125, continuing from phase 3.

### Layer 1 — Collision helper (unit, pure)

**File: `apps/web/src/__tests__/toolpack-collisions.util.test.ts`** (new)

120. **Empty result for a non-colliding selection** — `["data_query", "statistics"]` produces `[]`. Built-in tool names are globally unique by `BUILTIN_TOOLPACKS` construction; this is a guarantee against future drift in the registry.
121. **Two custom packs sharing a tool name** — both packs in the customs payload define `lookup_company`; the helper returns one collision entry with both pack display names sorted alphabetically.
122. **Built-in vs. custom collision** — a custom pack (hypothetically) defining `sql_query` and a built-in `data_query` selection produce a collision entry naming both. (Note: registration rejects this at phase 2 registration time, but the helper still detects it for defensive UI consistency in case a stale row sneaks through.)
123. **Unresolvable refs skipped** — `org:does-not-exist` not in the customs payload is silently ignored; the helper returns `[]` instead of crashing.

### Layer 2 — Dialog warnings (component)

Extend `CreateStationDialog.test.tsx` and `EditStationDialog.test.tsx` (one case each).

124. **`CreateStationDialog`**: with a customs payload containing two packs that both define `lookup_company`, picking both via the autocomplete renders the `<Alert>` with both pack names and the conflicting tool. Removing one selection makes the alert disappear.
125. **`EditStationDialog`**: same flow on the edit dialog. Use the existing `MultiSearchableSelect` interaction.

### Test totals

**6 new test cases** (120–125). No backend test changes. No integration tests required — the dialog rendering is fully covered by web unit tests, and the helper is pure.

---

## Acceptance criteria

- [ ] Cases 120–125 pass.
- [ ] `cd apps/web && npm run test:unit` green; existing 2100+ tests stay green.
- [ ] `npm run lint && npm run type-check` clean from the repo root.
- [ ] Manual smoke (dev server): register two custom packs that both define a `lookup_company` tool; open `EditStationDialog` for any station and attach both; confirm the warning Alert renders with both pack names and the tool name. Remove one; confirm it disappears. Save the station; confirm the save succeeds (warn-don't-block).

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| The collision warning is noisy when a user is mid-fix and intentionally wants both packs attached for a moment. | Save isn't blocked. The warning provides information; the user decides. P-4.1. |
| The collision helper is called every render and walks the entire toolpacks list — perf concern. | Wrapped in `useMemo` keyed by `form.toolPacks` and the customs payload. The toolpacks list is bounded (handfuls of packs per org); the inner walk is O(packs × tools) ≈ O(50). Negligible. |
| The customs payload arrives lazily; first render after open() shows no warning even when one would apply, then snaps in once the query lands. | The `<Alert>` simply isn't shown until the data resolves; saving in that gap is unchanged behavior (the runtime check remains the canonical guard). v1 doesn't add a loading skeleton — the warning reflects the latest snapshot of state. |
| A station was saved before phase 4 with a colliding selection; the user opens `EditStationDialog` and immediately sees the warning. | That's the intended outcome — surface the latent issue. The warning is informational, not destructive. |

**Rollback** is a single-PR revert. The new helper file can be deleted; the two dialog edits are mechanical.

---

## Files touched

### `apps/web`

- New: `src/utils/toolpack-collisions.util.ts`
- New: `src/__tests__/toolpack-collisions.util.test.ts`
- Edit: `src/components/CreateStationDialog.component.tsx` — render the collision Alert when the helper returns non-empty.
- Edit: `src/components/EditStationDialog.component.tsx` — same.
- Edit: `src/__tests__/CreateStationDialog.test.tsx`, `src/__tests__/EditStationDialog.test.tsx` — case 124 / 125.

No core, API, or schema changes. No new dependency. No migration. No env-var change.
