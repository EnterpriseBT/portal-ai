# Patch core vite → 6.4.3 (dev-server WS advisory) — Condensed design (#560)

**Issue:** [EnterpriseBT/portal-ai#560](https://github.com/EnterpriseBT/portal-ai/issues/560) · Task · **small / condensed**.

**Why.** New `vite` advisories entered the DB after #551. The **high** one — `GHSA-p9ff-h696-f583`, dev-server WebSocket **arbitrary file read**, range `>=6.0.0 <=6.4.1` — applies to the repo's **6.x** vite (used by `packages/core` + root build tooling), hoisted at `node_modules/vite@6.4.1`. Fix = **6.4.3** (patch, same major). `apps/web`'s separate vite 5.x (`GHSA-fx2h`, Windows `server.fs.deny`) is **#561**.

## Current shape

| Piece | Location | Note |
|---|---|---|
| core vite dep | `packages/core/package.json:122` | `^6.4.1` → `^6.4.3` |
| hoisted 6.x vite | `node_modules/vite` | was 6.4.1; shared by `@tanstack/router-plugin`, `@vitejs/plugin-react`, `@storybook/builder-vite`, `vite-plugin-svgr`, `vitefu` (all accept `^6`) |
| apps/web vite | `apps/web/node_modules/vite` (5.4.21) | independent nested 5.x — **not** touched here (#561) |

## Decision — patch bump + a scoped override

Bump `packages/core` vite `^6.4.1` → `^6.4.3`. That alone left the **hoisted** `vite@6.4.1` in place (npm keeps a satisfied transitive; `npm update vite` won't move it), so add a **scoped override** `"vite@6.4.1": "6.4.3"` in the root `overrides` — it forces the resolved 6.4.1 to 6.4.3 wherever it dedupes, while leaving `apps/web`'s `5.4.21` (a non-matching version) untouched. Deterministic and minimal; the key goes inert once the ecosystem moves past 6.4.1.

**Nuance:** the `npm audit` **`vite` line stays `high`** after this — because `apps/web`'s 5.x still carries `GHSA-fx2h` (#561). This PR removes the *more serious* dev-server-WS file-read high (`GHSA-p9ff`) + a moderate from the 6.x copy; the aggregate count only drops once #561 lands.

## Plan — 1 slice

**Files**
- `packages/core/package.json` — vite `^6.4.1` → `^6.4.3`.
- `package.json` (root) — add `"vite@6.4.1": "6.4.3"` to `overrides`.
- `package-lock.json` — regenerated (hoisted vite → 6.4.3; apps/web stays 5.4.21).

**Tests** — dep patch validated by suites: `npm run build` (vite drives it), `type-check`, `lint`, core (1771) + web (3009) unit suites. Green is the gate.

## Smoke (suites, per #551 disposition)

1. build · type-check · lint · core+web unit — all green. ✓
2. `npm ls vite` → hoisted `node_modules/vite` is `6.4.3`; `apps/web` stays `5.4.21`. ✓
3. `npm audit` → the 6.x vite node no longer flagged; `GHSA-p9ff` gone. The `vite` line remains (apps/web 5.x → #561). ✓

## Out of scope

- `apps/web` vite 5→6 major (`GHSA-fx2h`, Windows dev-server) — **#561**.
- The 9 moderate accept-and-monitor residuals — **#553**.
