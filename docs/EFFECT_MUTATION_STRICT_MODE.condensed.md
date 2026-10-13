# Effect-fired mutations under StrictMode — Condensed design (#783)

**Issue:** [EnterpriseBT/portal-ai#783](https://github.com/EnterpriseBT/portal-ai/issues/783) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** In development, StrictMode runs a mount effect twice. When the effect fires a `useAuthMutation` call, #751's in-flight guard hands the second run the first run's promise. Meanwhile React Query's `MutationObserver` dropped that mutation on the simulated unmount (`onUnsubscribe` → `removeObserver`, and only `mutate()` re-adds one). So the hook's `isPending` never clears, `data`/`error` never update, and observer-level per-call callbacks never run. The **promise** still settles correctly. Dev only, and web only (`apps/web`).

## Current shape

| Piece | Location | Note |
|---|---|---|
| In-flight guard | `apps/web/src/utils/api.util.ts:366–392` (`useAuthMutation`) | a duplicate key returns the running promise; no second `mutation.mutateAsync` |
| Duplicate's callbacks dropped | `__tests__/auth-mutation-single-flight.test.tsx` "runs only the first call's per-call callbacks" | by design since #751 |
| Observer detach | `@tanstack/query-core` `mutationObserver.js` `onUnsubscribe` | removes the observer from the current mutation; resubscribe doesn't re-add |
| StrictMode | `providers/Application.provider.tsx:46` | wraps the app in dev |
| Effect-fired calls today | `components/EndpointTestDialog.component.tsx:172` | already reads the promise and tracks its own pending state (#780) |
| | `views/AcceptInvitation.view.tsx:188` | already complies: `acceptAsync` (a `mutateAsync`) with its own module-level in-flight map, which also survives a real remount |
| | `views/Portal.view.tsx:143` | `touchMutation.mutate(…, { onSuccess: invalidate })`. A same-millisecond double run is deduped and the invalidation is lost |

## Decision — the promise is the contract for an effect-fired call; enforce it

Options from the ticket:
- **(a) Hook-local `isPending`/`data`/`error` driven by the shared promise.** This re-implements React Query's mutation state beside it. Consumers would read a mix of two sources (`status`, `variables`, `reset()` stay React Query's), and only dev StrictMode ever needs it.
- **(b) Let a duplicate through when the hook's `isPending` is false.** That condition is also true for #751's own case: a double-click inside the render lag, before `isPending` has rendered. It would bring the duplicate requests back. Rejected.
- **(c) Keep the guard.** A call fired from an effect reads its **promise** (`mutateAsync`), never the hook's state or per-call callbacks, and a guard enforces it.

**Chosen: (c)**, confirmed: a dev-only quirk is acceptable as long as it's easy to smoke-test around, and nothing risks production. The promise is the one value that is correct in every mode. Effects are the only place StrictMode double-invokes, and they never need render-lag dedupe semantics beyond "send once". Concretely:
- `Portal.view.tsx` switches to `mutateAsync(...).then(invalidate)`. It stamps `lastOpened` **once per visit** (a ref keyed by portal id), so StrictMode's second run sends an identical body and joins the first request: exactly one PATCH. It refreshes the list **once per request** (it remembers the last promise it chained). The refresh still runs after leaving the page, so the dashboard shows the new time.
- A new guard fails CI, inside any `useEffect`/`useLayoutEffect` callback (arrow, function, async, block or expression body), on: `.mutate(`; a call through a name destructured from `mutate`; and `mutateAsync` (or a name destructured from it) with a second, options argument. It parses with strings and comments blanked out, and its self-test checks that it parses at least 50 effects in the real source.
- `EndpointTestDialog` already complies.
- CLAUDE.md ("API Calls & SDK Helpers") and its copilot mirror record the rule beside the #751 bullet.

## Plan — one slice

**Files**
- `apps/web/src/views/Portal.view.tsx`: the `lastOpened` effect uses `mutateAsync(…).then(() => queryClient.invalidateQueries({ queryKey: queryKeys.portals.root })).catch(() => {})`.
- New `apps/web/src/__tests__/effect-mutation.guard.test.ts`: scans `src/**` (minus `__tests__`/`stories`) for `useEffect(` bodies (balanced braces) containing `.mutate(`. It has a self-test on embedded fixtures (flags `useEffect(() => { x.mutate(1) })`, passes `mutateAsync` and a `.mutate(` in a click handler) and an empty allowlist.
- `CLAUDE.md` + `.github/copilot-instructions.md`: one sentence each.
- `packages/e2e/README.md` (durable; the smoke-walk harness's reference): a troubleshooting note. If a dev walk shows an action stuck pending while the network tab shows it succeeded, it's this StrictMode quirk (#783), not a product bug. Confirm with the response, and check the component reads the promise. Production never double-runs effects, so the quirk can't reach users, and nothing here changes `useAuthMutation`.

**Tests**
- `__tests__/auth-mutation-single-flight.test.tsx`: a new StrictMode case. Render a component under `<StrictMode>` that fires `mutateAsync` from a mount effect, and assert one request is sent and **both** runs' promises resolve with the payload. This pins the contract the rule relies on.
- `__tests__/PortalView.gates.test.tsx`: the `touch` mock exposes `mutateAsync`; `portals.root` is invalidated once it resolves. A re-run of the effect (write flipped off and on, clock moved on) reuses the visit's timestamp and refreshes once. This uses a dependency flip rather than `<StrictMode>`, because the shared `test-utils` render doesn't double-run effects under its providers.
- `npm run test:unit -- --testPathPattern 'effect-mutation|auth-mutation-single-flight|PortalView|EndpointTestDialog'` (web), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. Open a portal you own (dev, StrictMode on). The network tab shows one `PATCH …/portals/<id>` with `lastOpened`, followed by a `GET` of the portals list (the invalidation ran). The portal's "last opened" on the dashboard updates.
2. From the dashboard, open the same portal again (its query is now cached, so write access is known at mount and StrictMode double-runs the touch effect). Still exactly one `PATCH …/portals/<id>`, and the portals queries refetch once, not twice. (The read-only case, no `lastOpened` without write, has no fixture: admins can write any portal and members can't open others'. `PortalView.gates.test.tsx` covers it.)
3. On a REST API connector, open an entity's **Test endpoint** dialog. It shows the records, not a stuck "Calling endpoint…" (the #780 workaround, still in place).
4. `npm run test:unit -- --testPathPattern effect-mutation` passes. Temporarily add a `.mutate(` inside a `useEffect` and it fails naming the file (then revert).

## Out of scope

- Fixing the observer detach inside `useAuthMutation` or React Query (options a/b above).
- Running a deduplicated call's per-call callbacks. #751 made a duplicate a no-op on purpose, and an effect reads the promise instead.
