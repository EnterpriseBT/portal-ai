# Bump npm-audit critical/high dependencies — Condensed design (#896)

**Issue:** [EnterpriseBT/portal-ai#896](https://github.com/EnterpriseBT/portal-ai/issues/896) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `npm audit` on `main` (`a89ab8df`) reports 30 findings: 5 critical, 8 high, 16 moderate, 1 low. All of them are dev or build-time: the Storybook dev servers, `ts-jest`'s `handlebars`, `concurrently`'s `shell-quote`, the marketing site's Astro/Vite chain, and the TanStack router generator's nested `zod`. None reaches the API runtime image, which Trivy gates anyway (#573). The fix should land before the accessibility epic (#791/#792), because that epic's tooling builds on Storybook. The change is the root lockfile and dependency ranges (`packages/core`, `apps/web`, `apps/api`, `apps/site`, and Prettier's range in every workspace), plus what the newer toolchain forced: 15 route files in `apps/web/src/routes/`, the regenerated route tree, and web's Jest setup.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Storybook 8.6.18 installed (`storybook`, `@storybook/*` `^8.6.15`) | `packages/core/package.json:92-118`, `apps/web/package.json:49-71` | Critical: preview origin validation. Patched in **8.6.19** (same minor) |
| `vite` `^6.4.3` (6.4.3 installed) | `packages/core/package.json:122`, `apps/web/package.json:74` | High. Patched in **6.4.5** |
| `concurrently` `^9.1.2` (9.2.4 pins `shell-quote@1.9.0`) | `apps/api/package.json:99` | Critical, via `shell-quote`. **9.2.5** depends on `shell-quote@1.12.0` |
| `ts-jest` `^29.4.6` → `handlebars@4.7.9` | 9 workspaces' `package.json` (e.g. `apps/api/package.json:107`) | Critical. Transitive; **4.7.10** is in range |
| `astro` `^7.3.2` → `vite@8.3.0`, `sharp@0.35.4`, `devalue@5.9.0` | `apps/site/package.json:24` | High. Patches in range: vite 8.3.5, sharp 0.35.5, devalue 5.9.4 |
| `@tanstack/router-plugin` `^1.159.5` → nested `zod` < 4.6.6 | `package.json:32` | High. Our own `zod` is 4.6.7 and unaffected |
| Root `overrides` | `package.json:52-55` | Only `@types/react*` today |

`npm audit fix --dry-run` reports every finding as fixable without `--force`, so no major bump is needed.

## Decision — lockfile refresh plus raised floors on direct deps; no overrides

- **Options:**
  - (a) `npm audit fix` alone, a lockfile-only change.
  - (b) (a), plus raising the declared floor of each **direct** dependency to its patched version: `storybook`/`@storybook/*` `^8.6.19`, `vite` `^6.4.5`, `concurrently` `^9.2.5`, and `@tanstack/router-plugin` to the version the fix resolves.
  - (c) Pin the transitive packages (`handlebars`, `shell-quote`, `devalue`, `sharp`, nested `zod`) through root `overrides`.
- **Chosen: (b).** With (a) alone, a later regenerated lockfile can silently drop back to the vulnerable versions; a floor in `package.json` records the security minimum where review sees it. Transitive packages stay governed by the lockfile only. Their parents' ranges already admit the fixes, and `overrides` stay sticky long after the parent catches up (the reason #545 kept them out).
- No major upgrades. Storybook 10, Vite 8 in web/core and `concurrently` 10 are out of scope (see below).
- Moderates and the low go in too if `npm audit fix` takes them non-breaking. Any it can't are listed on the PR rather than forced.
- **Found during implementation.** Moving packages surfaced dependencies the code used but never declared, and these are now declared:
  - **`@storybook/react` `^8.6.19` in core and web.** About 96 story files import it, and it only resolved because npm placed it at the root.
  - **`cookie` `^2.0.1` in `apps/site`.** Astro's built prerender bundle in `apps/site/dist` imports `cookie` bare, so it resolves from `apps/site`, not from inside `astro`. With astro installed at `apps/site/node_modules/astro`, its own `cookie@2` landed nested under it, and the bundle found the root's `cookie@0.7.2` instead and failed on the missing `parseCookie` export. The declared range tracks astro's own `cookie` range (`^2.0.1` in astro 7.3.8): an astro bump that moves it must move this too.
- **The web test setup stubs `window.scrollTo`.** TanStack Router moved from 1.163 to 1.170 within its range and now calls `scrollTo` on load. jsdom logs "Not implemented" for it, which failed `HelpRoute.test.tsx`'s no-console-error assertion.
- **Route ids are string literals.** The patched nested `zod` needs `@tanstack/router-generator` ≥ 1.167.6, which rejects `createFileRoute(ApplicationRoute.X)` ("expected route id to be a string literal"). It only logs the error and the build still exits 0, so `routeTree.gen.ts` silently stopped updating; the smoke walk found this. The 15 enum routes now pass the literal, which `createFileRoute` type-checks against the generated tree, so nothing is lost. The regenerated tree has the same routes, reordered by the new generator. `apps/web/.tanstack/` (the generator's scratch directory) is now gitignored.
- **`astro` is pinned to `~7.3.8`.** 7.4 requires Node ≥ 22.23.4, past the CI runner's Node 22, and failed Static Checks. 7.3.8 needs ≥ 22.12 and already requires the patched `vite` ^8.3.1 and `devalue` ^5.9.4.
- **Prettier is held at 3.8.1** (`~3.8.1` in every manifest, so a regenerated lockfile can't drift). The fix's in-range updates pulled in 3.9, which reformats 55 source files. That's unrelated churn, so the formatter is pinned back.
- **`@tanstack/react-router` floor `^1.170.46`**, the plugin's peer range; the regenerated tree and the `scrollTo` stub assume it.
- **`application-route.guard.test.ts`** checks every `ApplicationRoute` value against the generated route paths (at type-check and at runtime), since literal route ids no longer tie the enum to the routes.

## Plan — 1 slice

**Files:**
- `package.json`, `package-lock.json`
- `packages/core/package.json`, `apps/web/package.json`, `apps/api/package.json`
- `apps/site/package.json`: the `astro` pin and the `cookie` declaration
- `apps/web/src/routes/*.tsx` (15 route ids), `apps/web/src/routeTree.gen.ts` (regenerated), `apps/web/.gitignore`
- `apps/web/src/__tests__/setup.ts` (`scrollTo` stub), `apps/web/src/__tests__/application-route.guard.test.ts`
- every workspace `package.json`: Prettier `~3.8.1`

**Steps:**
1. Run `npm audit fix` with full network access; container counts under-report.
2. Raise the direct-dependency floors listed above, then `npm install` so the lockfile and manifests agree.
3. Re-run `npm audit` and record before/after counts in the PR body. The target is 0 critical and 0 high.

**Tests (CI is the authority; locally run what the bump touches):**
- `npm run build`, `npm run type-check`, `npm run lint`, `npm run format:check`
- `npm run test` (unit), web and core above all, since they run under `ts-jest` and Vite
- The integration suite runs in CI; an API runtime dependency doesn't move.
- The API image Trivy gate runs at the next Deploy Dev after merge.

Commit: `chore: bump npm-audit critical/high dependencies (#896)`

## Smoke (manual, against your dev stack)

1. `npm audit` reports **0 critical, 0 high**. Record the full before/after counts on the PR.
2. `npm run dev`: the API starts under `concurrently` (watch and server both running), and web loads at http://localhost:3000 after sign-in.
3. `npm run storybook`: core Storybook (:7006) and web Storybook (:7007) both load and render one story each, with no console errors from the preview.
4. `npm run build --workspace @portalai/site` succeeds, and `npm run dev --workspace @portalai/site` serves http://localhost:3002 with images (sharp) rendering on the home page.
5. The web route tree regenerates: touch a route file under `apps/web/src/routes/` with `npm run dev` running, and `routeTree.gen.ts` stays unchanged (`git diff --quiet`).
6. After merge: Deploy Dev's Trivy gate passes and `deploy-dev` stays green.

## Out of scope

- **`qs` (moderate, API runtime).** Express 4 pins `qs` to 6.14.x and 6.15.x, both inside the advisory range, so no in-range fix exists. Forcing one with an `overrides` entry would run Express on a `qs` it doesn't declare. Moving to Express 5 fixes it; that's tracked in #897.
- **`esbuild` via `drizzle-kit`, and `uuid` via `exceljs` (moderate).** Only major upgrades fix them.

- **Major upgrades:**
  - Storybook 10 (the a11y epic's tooling may want it; that's #792's call).
  - Vite 8 in web/core.
  - `concurrently` 10.
- **Enabling GitHub secret scanning or Dependabot alerts on the repo.** That's a settings change, worth its own ticket.
- **The scheduled audit workflow (#545)** stays informational and non-gating.
- **A CI check for a stale route tree** (the generator only logs its errors): #899.
- **Raising Node in CI, devcontainer and `engines`**, which lets the `astro` pin go: #900.
