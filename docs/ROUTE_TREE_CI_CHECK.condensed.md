# Fail CI on a stale route tree — Condensed design (#899)

**Issue:** [EnterpriseBT/portal-ai#899](https://github.com/EnterpriseBT/portal-ai/issues/899) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The TanStack router generator writes `apps/web/src/routeTree.gen.ts` from the files in `apps/web/src/routes/`. When it rejects a route file, the Vite plugin catches the error and only logs it, `vite build` exits 0, and the tree silently stops updating: new routes never register while every check stays green. #896 hit exactly this (15 enum route ids rejected by router-generator 1.167); only its smoke walk noticed. The change makes a generator error fail the web build, and makes CI fail when the committed tree differs from what the generator produces. It touches `apps/web` and the Static Checks workflow.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Plugin registration | `apps/web/vite.config.ts:111` | `tanstackRouter({ target: "react", autoCodeSplitting: true })`, no `tsr.config.json` |
| Error swallowed | `node_modules/@tanstack/router-plugin/dist/esm/core/router-generator-plugin.js:37-41` | `try { await generator.run() } catch (e) { console.error(e) }` |
| Generator throws | `node_modules/@tanstack/router-generator/dist/esm/generator.js:143`, `:529` | A rejected route aborts the whole run, so the tree isn't written at all; a diff of it alone stays clean |
| Web build | `apps/web/package.json:8` | `tsc && vite build` |
| CI | `.github/workflows/static-checks.yml:71` | `npm run build` → type-check → lint; nothing inspects the tree |
| Partial guard (#896) | `apps/web/src/__tests__/application-route.guard.test.ts` | Catches a stale tree only for paths `ApplicationRoute` names |
| Generator dep | `package.json:32` | Only `@tanstack/router-plugin` is declared; `@tanstack/router-generator` resolves through it |

## Decision — run the generator fail-closed in the build, and diff the tree in CI

- **Options:**
  - (a) A CI step that diffs `routeTree.gen.ts` after the build. Catches a tree someone forgot to commit, but **not** #896's case: the failing run writes nothing, so the committed tree matches.
  - (b) Run the generator directly (`new Generator({ config: getConfig(opts, root), root }).run()`), where its error propagates and exits 1. Catches every rejected route, locally and in CI.
  - (c) Make the Vite build fail on the plugin's error, e.g. by wrapping the plugin or watching `console.error`. Depends on plugin internals that change between versions.
- **Chosen: (b) + (a).** Prototyped on this branch: a route with a non-literal id exits 1 with `Error transforming route file …`, and a clean tree regenerates byte-identical.
  - `apps/web/scripts/generate-routes.mjs` runs the generator with the same options as `vite.config.ts`, so both produce the same tree. Those options move into one exported constant (`scripts/router-options.mjs`) both import, so they can't drift.
  - Web's `build` becomes `node scripts/generate-routes.mjs && tsc && vite build`: a local build fails too, not only CI, and `tsc` checks the fresh tree.
  - Static Checks adds a step after Build that runs the generator itself, then `git diff --exit-code` over `routeTree.gen.ts` **and `src/routes`**, failing with a message saying to commit them. It runs the generator rather than trusting the build's run, because a turbo cache hit replays a build that exited 0 without regenerating, so re-running a red check would pass on the same stale tree (code review). `src/routes` is diffed too because the generator also silently rewrites a route file whose literal id doesn't match its path (checked: `/tags-wrong` went back to `/tags`).
  - The script takes both the generator and `getConfig` **through `@tanstack/router-plugin`**, nothing declared separately. The plugin pins its generator exactly, so a separate root range could drift to another version; and the plugin's `getConfig` parses its plugin-only options too (code review).
  - The generator still also runs inside `vite build` (this plugin version has no switch to turn it off). It's well under a second, so the duplicate run is accepted.
- The dev server keeps logging and carrying on. Failing a running dev server on a half-typed route file would be worse; the build catches it.

## Plan — 1 slice

**Files:**
- `apps/web/scripts/generate-routes.mjs` (new)
- `apps/web/scripts/router-options.mjs` + `.d.mts` (new; the shared plugin options, typed like `render-config.mjs`), `apps/web/vite.config.ts`
- `apps/web/package.json` (`build`, plus a `generate:routes` script)
- `.github/workflows/static-checks.yml` (diff step)
- `CLAUDE.md` + `.github/copilot-instructions.md` (Routing: the build regenerates the tree and fails on a rejected route; commit the tree)

**Tests:**
- `npm run build --workspace @portalai/web` passes on the current routes, with `routeTree.gen.ts` unchanged.
- Negative check, by hand: a temporary route with `createFileRoute(SOME_CONST)` fails `npm run generate:routes --workspace @portalai/web` and the build, then is removed.
- `npm run lint:ci-cache` still passes (the workflow change mustn't break its rules).
- CI: Static Checks green.

## Smoke (manual, against your dev stack)

1. `npm run build --workspace @portalai/web` succeeds and `git diff --quiet apps/web/src/routeTree.gen.ts` holds.
2. Add `apps/web/src/routes/zz-smoke.tsx` with `const ID = "/zz-smoke"; export const Route = createFileRoute(ID)(…)`. `npm run build --workspace @portalai/web` fails, naming the file and "expected route id to be a string literal".
3. Change it to `createFileRoute("/zz-smoke")(…)`. The build passes and `routeTree.gen.ts` now lists `/zz-smoke`; `git diff --exit-code` on it fails, which is the CI step's signal to commit the tree.
4. Remove the file, rebuild, and `routeTree.gen.ts` is back to clean.
5. With `npm run dev` running, step 2's file only logs the error and the dev server keeps serving (unchanged behavior).

## Out of scope

- **Failing the dev server on a generator error.** It would block work on every half-typed route file; the build is the gate.
- **The dev watcher not registering a new route within 20s** (seen during #896's smoke). Not reproduced or investigated; file it separately if it recurs.
- **Raising Node / unpinning astro:** #900.
