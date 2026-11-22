# Route files export only `Route` — Condensed design (#1109)

**Issue:** [EnterpriseBT/portal-ai#1109](https://github.com/EnterpriseBT/portal-ai/issues/1109) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** TanStack Router's plugin moves each route's `component` into a lazy chunk, but it can't move anything the route file also exports. Three route files export their route component, so Dashboard, Settings and Not-invited (and the views they import) ship in the main bundle, and `npm run dev` warns about all three. A fourth, `invitations.accept.tsx`, exports the page its private route component renders, which the plugin doesn't warn about but which has the same effect. The fix keeps every route file's components private and adds a guard so it doesn't recur. `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Dashboard route | `apps/web/src/routes/index.tsx:10` | `export function DashboardRoute()`; no importer |
| Settings route | `apps/web/src/routes/settings.tsx:24` | `export function SettingsRoute()`; no importer |
| Not-invited route | `apps/web/src/routes/not-invited.tsx:18` | `export function NotInvitedPage()`; imported by `__tests__/NotInvitedPage.test.tsx` |
| Accept route | `apps/web/src/routes/invitations.accept.tsx:31` | private `AcceptInvitationRoute` reads `Route.useSearch()`, renders the exported `AcceptInvitationPage`; imported by `__tests__/AcceptInvitationPage.test.tsx` |
| Test router | `apps/web/src/__tests__/test-utils.tsx:38` | root route only, memory history fixed at `/`, so `Route.useSearch()` has no match there |
| Build today | `vite build` | no chunk for index/settings/not-invited; `invitations.accept` chunk is 0.31 kB (the wrapper only) |

## Decision — private route components; tests render `Route.options.component`

Options: (a) drop the exports and have the tests render the route's own component; (b) move each page composition (`Authorized` + layout + view) into a non-route file the route imports; (c) drop only the three warned exports.

**Decision: (a), for all four files.** (b) adds a file per page with no consumer but a test, and a single-component file holding `Authorized` is wiring, which the Component File Policy doesn't allow alone. (c) leaves the accept page in the main bundle. The not-invited test renders `Route.options.component` directly. The accept page keeps reading its token through `Route.useSearch()`, so its test registers the real route under a root route (as the generated tree does) and renders it at `/invitations/accept?token=tok-1`. *(Code review: reading the token from `useRouterState`'s location instead flipped it to undefined while a navigation away was loading the next route's chunk, flashing the "incomplete link" state after a successful accept.)*

**Guard:** `apps/web/src/__tests__/route-exports.guard.test.ts` parses each file under `src/routes/` (TypeScript AST) and fails on any export other than a lone `export const Route` and type-only exports (`__root.tsx`'s `RouterContext`). A line in CLAUDE.md's Routing section records the rule.

## Plan — 1 slice

**Files**
- Edit: `routes/index.tsx`, `routes/settings.tsx`, `routes/not-invited.tsx` (drop `export`); `routes/invitations.accept.tsx` (one private component, still on `Route.useSearch()`).
- Edit: `__tests__/NotInvitedPage.test.tsx` (render `Route.options.component`), `__tests__/AcceptInvitationPage.test.tsx` (register the route under a root and render it at its URL).
- New: `__tests__/route-exports.guard.test.ts`. Edit: `CLAUDE.md` (Routing).

**Tests:** the guard (red first against today's four files), the two page tests, `npm run test:unit -- --testPathPattern '(route-exports|NotInvitedPage|AcceptInvitationPage)'`; `npm run lint`, `npm run type-check`, `npm run build` in `apps/web`.

## Smoke (manual, against your dev stack)

1. `npm run dev` → the web output has no `[tanstack-router] … will not be code-split` lines.
2. `npm run build --workspace @portalai/web` → `dist/assets` has chunks named for `index`, `settings` and `not-invited`, and `invitations.accept`'s chunk is no longer ~0.3 kB.
3. In the app: Dashboard, Settings (and `/settings?tab=billing` opening Billing) render as before.
4. Open `/invitations/accept?token=bogus` signed in → the accept page renders (its refusal for a bogus token), with no app chrome (no sidebar or org switcher).
5. `/not-invited` renders "You need an invitation".

## Out of scope

- Splitting the 2.3 MB main bundle further (`manualChunks`, lazy views): separate work.
- An ESLint rule instead of a test guard: the repo's guards are tests.
