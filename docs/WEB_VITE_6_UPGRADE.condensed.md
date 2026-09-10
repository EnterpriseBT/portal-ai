# Upgrade apps/web vite 5→6 (server.fs.deny advisory) — Condensed design (#561)

**Issue:** [EnterpriseBT/portal-ai#561](https://github.com/EnterpriseBT/portal-ai/issues/561) · Task · **small / condensed** (sizing revised from `full` — the change turned out config-free; see Decision).

**Why.** The last `npm audit` **high** — `vite` `GHSA-fx2h-pf6j-xcff` (`server.fs.deny` bypass on Windows alternate paths, `<=6.4.2`) — is carried by `apps/web`'s vite `5.4.21`. No 5.x patch exists, so the fix is a **vite 5→6 major** to `^6.4.3` (matching `packages/core`, already on 6.4.3 from #560). This clears the **last high** — audit **10 → 9, 0 high / 0 critical**.

## Current shape

| Piece | Location | Note |
|---|---|---|
| apps/web vite dep | `apps/web/package.json:72` | `^5.4.10` → `^6.4.3` |
| vite config | `apps/web/vite.config.ts` | 3 custom plugins (`serve-catalogs`, `version-json`, `raw-d3-umd`) + svgr/tanstack-router/react; `build.rollupOptions.output.manualChunks` (object form); `server` proxy/headers/fs |
| plugin peers | — | react/svgr/tanstack-router/storybook-builder **all** peer `^6` (verified) — no bump needed |
| #560 override | root `package.json` overrides | `"vite@6.4.1": "6.4.3"` — **now redundant** (nothing resolves 6.4.1 once apps/web is 6.x) |

## Decision — target vite 6 (not 7/8), no config change

Bump to `^6.4.3`, **matching core** so the monorepo has one vite line (hoisted 6.4.3; apps/site's astro keeps its own vite 8, unflagged). **Not vite 8** — v8 (rolldown) **removes the object form of `output.manualChunks`**, which this config uses for the lazy maplibre chunk; vite 6 keeps it. Assessed the v5→v6 breaking changes: none apply (no Sass, standard target, plugins all v6-compatible), so **`vite.config.ts` is unchanged**. Also **remove the redundant #560 override**.

**npm quirk (recorded):** bumping the range + `npm install`/`dedupe` would **not** drop apps/web's stale nested `vite@5.4.21` (npm marked it `invalid: "^6.4.3"` but kept it). Fix: delete that one `apps/web/node_modules/vite` entry from `package-lock.json` + the dir, then `npm install` — it dedupes to the hoisted 6.4.3.

## Plan — 1 slice

**Files**
- `apps/web/package.json` — vite `^5.4.10` → `^6.4.3`.
- `package.json` (root) — drop the redundant `"vite@6.4.1"` override.
- `package-lock.json` — reconciled to a single vite `6.4.3` for the app + core.

**Tests** — dep major validated by suites + a live dev/build smoke: `npm run --workspace @portalai/web build`, `type-check`, `lint`, web unit (3009). Green is the gate.

## Smoke (suites + live dev/build)

1. build · type-check · lint · web unit (3009) — all green. ✓
2. `npm audit` → `vite` **cleared**; total **10 → 9, 0 high / 0 critical**. ✓
3. `npm ls vite` → app + core on one `6.4.3`; no `5.x`. ✓
4. Live (dev stack, vite 6): server boots, `/version.json` served by the `version-json` plugin (`{"version":"dev"}`), app renders authed through the vite-6 transform pipeline (react/svgr/router/catalogs), **0 console errors**. ✓
5. Post-merge: normal app-dev deploy smoke.

## Out of scope

- The 9 moderate accept-and-monitor residuals — **#553**.
