# Accessibility tooling and audit inventory — Spec

**Issue:** [EnterpriseBT/portal-ai#792](https://github.com/EnterpriseBT/portal-ai/issues/792) · **Epic:** #791 · **Discovery:** `docs/A11Y_TOOLING_AUDIT.discovery.md` · **PR:** #967 → `epic/a11y-conformance`

This spec fixes the scripts, configs, the result format, the route manifest and the inventory doc's layout for the report-only accessibility tooling. Nothing here can fail an existing CI check, and #799 turns each tool into a gate without changing its shape.

## Key decisions (flag for review)

1. **Separate lint config.** jsx-a11y runs from a sibling `eslint.a11y.config.js` using the `strict` preset. No `lint` script loads it (discovery D1).
2. **jest-axe helper.** `expectNoAxeViolations` is duplicated in web and core, with `color-contrast` and `region` disabled under jsdom (D2).
3. **Stories sweep.** `a11y:stories` runs under its own Jest config, which `test:unit` never matches. It records violations and never asserts (D3).
4. **Browser walk.** It runs as two Playwright projects, `a11y` and `a11y-site`, that exist only for local targets. CI's explicit `--project` list is untouched (D4).
5. **States.** Empty, error, loading and locked are produced by intercepting responses with `page.route`, with no seed changes (D5). Every route is walked in `brand` and `brand.dark` (D6).
6. **Inventory generator.** `scripts/a11y-inventory.mjs` rewrites only the marked section of `docs/A11Y_AUDIT.md`, and fails on an unmapped jsx-a11y rule, a missing result file, or an empty run (D7, failure-mode lean).
7. **Manual pass scope.** The manual passes cover six flows. axe covers every leaf route (discovery Q1).
8. **D3 charts.** The sandboxed D3 iframe gets a frame-level result plus a manual finding (Q3).
9. **Manual-only WCAG 2.2 criteria.** 2.4.11, 2.5.7, 3.3.7 and 3.3.8 are fixed rows in the keyboard checklist (Q4).
10. **Raw results.** `a11y-results/` is gitignored, and the doc is the committed record (Q5).
11. **The inventory's self-test is not wired into CI here.** #799 adds it alongside the gates, so this PR changes no workflow.

## Scope

### In scope
- Dependencies, the jsx-a11y report configs and the `a11y:lint` scripts (web, core, site).
- The jest-axe matcher and helper (web, core), plus the `a11y:stories` sweep (web, core).
- The `@axe-core/playwright` projects, the route manifest, state interception, and the `a11y:axe` and `a11y:axe:site` scripts (e2e).
- `scripts/a11y-inventory.mjs` with `--self-test`, and the root scripts `a11y:report`, `a11y:inventory` and `lint:a11y-inventory`.
- `docs/A11Y_AUDIT.md`: the generated findings, the keyboard checklist and findings, the screen-reader script and findings.
- A slice of the inventory appended to each of #793–#798's issue bodies.

### Out of scope
- Fixing findings, turning on any gate, and adding `expectNoAxeViolations` calls to existing tests (those belong to #793–#799).
- Deployed-env (app-dev or prod) axe runs.
- ACR content (#800).

## Surface

### Dependencies (devDependencies, exact versions land in the lockfile)

| Package | Adds |
|---|---|
| `apps/web`, `packages/core` | `eslint-plugin-jsx-a11y@^6.10.2`, `jest-axe@^11.0.0`, `@types/jest-axe@^3.5.9` |
| `apps/site` | `eslint-plugin-jsx-a11y@^6.10.2` (eslint-plugin-astro's preset loads it) |
| `packages/e2e` | `@axe-core/playwright@^4.14.0` |

### `eslint.a11y.config.js` (new in `apps/web`, `packages/core`, `apps/site`)

Web and core: the package's default export from `./eslint.config.js`, spread unchanged, followed by:

```js
{
  files: ["src/**/*.tsx"],
  plugins: { "jsx-a11y": jsxA11y },
  rules: jsxA11y.flatConfigs.strict.rules,
  settings: { "jsx-a11y": { polymorphicPropName: "component",
    components: { Button: "button", IconButton: "button" } } },
}
```

The `components` map is deliberately small. It names only MUI primitives that always render the mapped element, and a wrong mapping would invent findings. Site: the base config followed by eslint-plugin-astro's flat `jsx-a11y-strict` config.

Both existing configs ignore `*.config.js`, so `lint` never parses the new file. Script, identical in all three packages:

```json
"a11y:lint": "sh -c 'eslint --config eslint.a11y.config.js src --format json --output-file a11y-results/eslint.json; s=$?; [ $s -le 1 ]'"
```

ESLint exits 1 when it finds problems and 2 on a config or crash error. The `[ $s -le 1 ]` keeps findings from failing the script but keeps a broken setup red.

### jest-axe helper

- **`setup.ts`** (web `apps/web/src/__tests__/setup.ts`, core `packages/core/src/__tests__/setup.ts`) adds `import { toHaveNoViolations } from "jest-axe"; expect.extend(toHaveNoViolations);`, next to the jest-dom import.
- **Web** `apps/web/src/__tests__/test-utils.tsx` and **core** `packages/core/src/__tests__/axe.util.ts` (new) each export:

```ts
/** jsdom has no layout or computed colour, and a lone component sits in no
 *  landmark, so the browser walk measures these. Mirrors <other package's file>. */
export const JSDOM_DISABLED_AXE_RULES = ["color-contrast", "region"] as const;
export async function expectNoAxeViolations(
  container: Element,
  options?: { disableRules?: readonly string[] }
): Promise<void>;
```

The helper calls `configureAxe` with every rule in `JSDOM_DISABLED_AXE_RULES ∪ options.disableRules` set to `enabled: false`, then runs `expect(await axe(container)).toHaveNoViolations()`.

### `a11y:stories` (web, core)

- **`jest.a11y.config.js`** (new) is `{ ...base, testMatch: ["<rootDir>/src/__tests__/__a11y__/**/*.a11y.tsx"], collectCoverage: false }`. Neither existing `testMatch` matches `*.a11y.tsx`, so `test:unit` never runs it.
- **Script:** `"a11y:stories": "NODE_OPTIONS=--experimental-vm-modules jest --config jest.a11y.config.js"`.
- **`src/__tests__/__a11y__/stories.a11y.tsx`** (new) works like this:
  - It calls `setProjectAnnotations` with `.storybook/preview`.
  - It discovers every `src/**/*.stories.tsx` with `fs.readdirSync(…, { recursive: true })`.
  - For each module it calls `composeStories(await import(file))`. Each story gets `await Story.load()`, an RTL `render(<Story />)`, and an axe run with `JSDOM_DISABLED_AXE_RULES` off. Play functions are not run.
  - It writes a `RawRun` per story (below). A story whose load or render throws is recorded `status: "skipped"` with the error message, never dropped.
  - After all stories it writes `a11y-results/stories.json`. The one assertion is that at least one story was found and at least one rendered (`ok`), so an empty sweep fails.

### Raw result format (written by the stories sweep and both Playwright projects)

```ts
// packages/e2e/src/lib/a11y-record.ts (web and core write the same shape)
interface RawResultFile { tool: "jest-axe" | "axe-app" | "axe-site"; package: string;
  generatedAt: string; axeVersion: string; runs: RawRun[] }
interface RawRun {
  context: { story?: string; file?: string /* repo-relative */; route?: string; url?: string;
             owner?: 793 | 794 | 795 | 796 | 797 | 798 /* the route's manifest owner (axe-app) */;
             role?: "owner" | "admin" | "member"; state?: A11yState; theme?: "brand" | "brand.dark" };
  status: "ok" | "skipped"; error?: string;
  violations: { id: string; impact: string | null; tags: string[];
                nodes: { target: string[] }[] }[];   // no html: keeps page text out of results
}
type A11yState = "populated" | "empty" | "error" | "loading" | "locked";
```

### Playwright projects (`packages/e2e/src/lib/playwright-config.ts`)

`buildConfig` adds the following, **only when `!target.deployed`**, after `roles`:

```ts
{ name: "a11y", testMatch: /a11y\/app\.a11y\.ts$/, retries: 0 },
{ name: "a11y-site", testMatch: /a11y\/site\.a11y\.ts$/, retries: 0,
  use: { baseURL: env.E2E_SITE_BASE_URL || "http://localhost:3002" } },
```

The scripts, in `packages/e2e/package.json`:
- `"a11y:axe": "dotenv -e .env -- playwright test --project=a11y"`
- `"a11y:axe:site": "playwright test --project=a11y-site"`

Each spec writes its `RawResultFile` to `a11y-results/{app,site}.json` in `afterAll`, and fails only on a setup problem:
- a missing `.auth/<role>.storageState.json` (the message names `npm run e2e:auth:all`);
- an unreachable `baseURL`;
- a manifest route that can't resolve its id;
- an empty run.

### Route manifest (`packages/e2e/src/lib/a11y-routes.ts`, new)

```ts
export type A11yOwner = 793 | 794 | 795 | 796 | 797 | 798;
export interface A11yRoute {
  id: string;                    // stable, e.g. "entity-detail"
  path: string;                  // literal, or containing ":id"
  drillFrom?: string;            // index path: click the first row/link and use the URL it lands on
  owner: A11yOwner;              // default owner for findings on this route
  roles?: E2eIdentity[];         // default all three
  states: Partial<Record<Exclude<A11yState, "populated">, string>>; // state → URL glob of the request to intercept
}
export const A11Y_ROUTES: readonly A11yRoute[];
export const SITE_PAGES: readonly string[]; // every built page path under apps/site/src/pages, incl. each use-case slug
```

`A11Y_ROUTES` covers every leaf route file under `apps/web/src/routes` except `login`, `not-invited` and `invitations.accept`. Those are walked signed out, as role `null`, from a fresh context. The "locked" state appears on `connectors/:id`, `entities/:id`, `entities/:id/records/:id` and `column-definitions/:id`, the four views that render `ConnectorInstanceLockAlertUI`, each intercepting its `…/running-jobs` request. `connectors/:id/layout-plan/edit` (RegionEditor) is included when the fixture org has a file-upload connector to drill into. Otherwise the run records it `skipped` with the reason, and the inventory lists it under coverage gaps.

### State interception (`packages/e2e/src/lib/a11y-states.ts`, new)

| State | `page.route(glob, …)` behaviour |
|---|---|
| `empty` | `route.fetch()`, then empty every array in `payload` and zero every numeric `total`/`count` key, then `route.fulfill` |
| `error` | fulfil `500` with the API's error envelope (the `success: false` shape from `apps/api/src/services/http.service.ts:74`), copied from a captured response into `src/fixtures/a11y-error.json` |
| `loading` | hold the request. Axe runs once `[role="progressbar"]` is visible, then the request continues |
| `locked` | `route.fetch()`, then insert `src/fixtures/a11y-running-job.json` into the payload's running-jobs list. The fixture is parsed with core's job schema at load, so a drifted fixture fails setup |

Theme: before navigation, `page.addInitScript` sets `localStorage["portalai-theme"] = JSON.stringify(theme)`. Site pages take `data-theme` the same way through its own init script, which reads the same key. axe runs with `withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa","best-practice"])`. The D3 iframe is cross-origin to axe, so it reports the `<iframe>` element only, and `docs/A11Y_AUDIT.md` carries a manual finding for its content.

### `scripts/a11y-inventory.mjs` (new, root)

- **Inputs.** It reads `apps/web/a11y-results/{eslint,stories}.json`, `packages/core/a11y-results/{eslint,stories}.json`, `apps/site/a11y-results/eslint.json` and `packages/e2e/a11y-results/{app,site}.json`. **Any missing file exits 1, naming it.**
- **Normalized finding:**

```ts
{ id: string /* stable hash of tool+rule+location */, tool: "eslint"|"jest-axe"|"axe-app"|"axe-site",
  package: string, rule: string, impact: string|null, wcag: string[] /* e.g. ["1.4.3"] */,
  location: string /* file:line | story id | route id + CSS target */,
  seen: { role: string|null, state: string|null, theme: string|null }[], owner: "#793"|…|"#798"|"unassigned" }
```

- **WCAG criteria.** For axe results, a `wcagNNN` tag becomes `N.N.N`. A finding with no such tag goes under "Best practice". For jsx-a11y, `JSX_A11Y_WCAG: Record<string, string[]>` maps every rule in the strict preset (with the `astro/` prefix stripped). **A rule missing from the map exits 1, naming it.**
- **Owner**, first match wins:
  1. Shell rules (`region`, `bypass`, `document-title`, `html-has-lang`, `page-has-heading-one`, `landmark-*`) on an app route go to #797.
  2. `apps/site/**` and `axe-site` go to #798.
  3. Path prefixes: `modules/RegionEditor` → #795; `modules/MapWidget` and `modules/D3Widget` → #796; `layouts/`, `SidebarNav`, `HeaderMenu`, `views/Loading` → #797; `ui/DataTable`, `DataTableBlock`, `PaginationToolbar`, `modules/TableWidget`, `EntityRecordDataTable`, `KeyValueTable` → #794; `ui/Modal`, `*Dialog.component.tsx`, `FormAlert`, `workflows/` → #793.
  4. An `axe-app` finding not matched above takes its route's `owner`.
  5. Otherwise, `unassigned`.
- **Dedupe.** Findings with the same `(tool, rule, location)` merge their `seen` lists. The `brand.dark` run of a rule other than `color-contrast` adds to `seen` and never adds a row.
- **Output.** It replaces the text between `<!-- a11y-inventory:start -->` and `<!-- a11y-inventory:end -->` in `docs/A11Y_AUDIT.md`. Missing or duplicate markers exit 1. **Zero `ok` runs across all inputs exits 1** ("an empty report isn't a clean one").
- **`--self-test`.** It runs against embedded fixtures and covers: tag-to-criterion mapping, owner precedence, dedupe across themes, the unmapped-rule failure, the missing-marker failure and the empty-run failure.

Root `package.json` scripts:
- `"a11y:inventory": "node scripts/a11y-inventory.mjs"`
- `"lint:a11y-inventory": "node scripts/a11y-inventory.mjs --self-test"`
- `"a11y:report"`: the per-package `a11y:lint` (web, core, site), then `a11y:stories` (web, core), then e2e's `a11y:axe` and `a11y:axe:site`, then `a11y:inventory`, chained with `&&` via `npm run -w`. No turbo task: the results depend on a running stack, so a cache hit would be wrong.

`.gitignore` gains `a11y-results/`.

### `docs/A11Y_AUDIT.md` (new, durable for the epic's life)

```
# Accessibility audit inventory
<purpose · how to regenerate (`npm run a11y:report`, preconditions) · lifecycle: #800 folds in or deletes>
## How it's produced (tools, scripts, preconditions)
<!-- a11y-inventory:start -->
## Coverage           (per result file: tool, version, ok runs, skipped runs with their reason)
## Summary            (owner × WCAG criterion counts)
<a id="owner-793"></a> ## #793 Dialogs and forms  … one section per owner, then ## Unassigned (best-practice rows carry "best practice" in the WCAG column)
<!-- a11y-inventory:end -->
## Keyboard pass      (per flow: checklist incl. 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11, 2.5.7, 2.5.8, 3.3.7, 3.3.8; findings KB-nn)
## Screen-reader pass (per flow: steps + expected announcement; findings SR-nn, with VoiceOver+Safari / NVDA+Firefox)
```

Each per-owner table has the columns `| WCAG | Rule | Impact | Location | Seen (role/state/theme) | Tool |`. The manual findings tables have `| ID | Flow | Step | WCAG | Observed | AT | Owner |`.

The manual passes cover these six flows:
1. Sign-in.
2. CSV import → records.
3. Station → portal → pin.
4. A curated view.
5. Settings → Members.
6. The marketing site's home → pricing → contact.

The agent walks the keyboard pass through Playwright MCP, as owner and as member. The user walks the screen-reader script.

### Issue slices

Each of #793–#798's bodies gets a `## Audit inventory (#792)` section, holding its count per WCAG criterion, its KB and SR IDs, and a link to `docs/A11Y_AUDIT.md#owner-<n>` on `epic/a11y-conformance`. It's written to a file and checked as non-empty and changed before `gh issue edit` (the issue-body guard).

## Migration
## Seed

No schema, migration or seed change. The fixture org from `e2e:seed` is used as it is.

## TDD test plan

### Inventory generator (`npm run lint:a11y-inventory`)
Self-test cases: `wcag143`→`1.4.3`; best-practice-only → Best practice; jsx-a11y map hit; unmapped rule → exit 1; each of the five owner rules plus `unassigned`; route-owner fallback; dark/light dedupe for a non-contrast rule; `color-contrast` kept per theme; marker replace leaves the manual sections byte-identical; missing marker → exit 1; missing input file → exit 1; zero ok runs → exit 1. **≈ 16**

### e2e unit (`npm run --workspace @portalai/e2e test:unit`)
- `playwright-config.test.ts`: a local target has `a11y` + `a11y-site`, a deployed target has neither, and `a11y-site`'s baseURL honours `E2E_SITE_BASE_URL`.
- `a11y-routes.test.ts` (new):
  - every leaf route file under `apps/web/src/routes` is either in `A11Y_ROUTES` or in the signed-out list, and no manifest path names a missing route;
  - `SITE_PAGES` matches `apps/site/src/pages`;
  - ids are unique;
  - locked states exist exactly on the four lock-alert views.
- `a11y-states.test.ts` (new): the empty transform empties nested arrays and zeroes totals; the locked transform inserts the job; the running-job fixture parses against core's schema; the error fixture has `success: false`.
- `a11y-record.test.ts` (new): violations are trimmed to `id/impact/tags/target` with no `html`.
- **≈ 14**

### Web and core unit (`npm run test:unit` in each)
`axe.util.test.tsx` (core) and an `expectNoAxeViolations` block in a web test-utils test:
- a clean fragment passes;
- an `<img>` with no `alt` fails with `image-alt`;
- low contrast is ignored (disabled);
- `disableRules` is honoured.
**≈ 8**

### Manual and run-level checks (recorded in the PR, not automated)
`npm run a11y:report` completes against the dev stack and the built site, and `docs/A11Y_AUDIT.md`'s generated section is non-empty with zero `unassigned` rows, or each one is explained. `npm run lint`, `npm run type-check` and `npm run test:unit` are unchanged.

**Totals ≈ 38 cases.**

## Acceptance criteria

- [ ] `npm run a11y:lint` (web, core, site), `a11y:stories` (web, core), `a11y:axe` and `a11y:axe:site` (e2e) each run with one command and write their per-package result file. Findings never fail them, and a broken setup does.
- [ ] `npm run a11y:report` regenerates `docs/A11Y_AUDIT.md`'s marked section from a clean checkout plus a running stack.
- [ ] Every inventory row names a WCAG 2.2 criterion (or sits under Best practice), a location, the role, state and theme it was seen in, and an owner. Any unassigned row carries a reason.
- [ ] The keyboard pass and the screen-reader pass for the six flows are recorded, VoiceOver and NVDA both, with findings owned.
- [ ] Each of #793–#798's issue bodies carries its slice.
- [ ] No workflow file changes; Static Checks, Unit Tests, Integration Tests and E2E Tests give the same results as on `epic/a11y-conformance`.

## Risks & rollback

- **The stories sweep can't render a story outside Storybook** (for example, web preview's no-op `localStorage`, or a story needing an MSW handler). Detected as a `skipped` run, which the Coverage section lists. Mitigation: per-story skip with the reason, never a silent drop.
- **The `empty` transform renders an impossible shape** (an array the UI expects non-empty). Detected as a render error in that run. The state is recorded `skipped` for that route.
- **False findings from the jsx-a11y `components` map.** It's kept to two certain mappings, and #799 reviews the rule set before gating.
- **The fail-mode is fail-closed on setup and open on findings.** A silently empty report would be read as conformance, which is the expensive error for an ACR, so emptiness is an error.
- **Rollback.** Everything is additive and nothing in CI calls it. Reverting the PR, or leaving the scripts unused, has no runtime effect.

## Files touched

- **New:**
  - `{apps/web,packages/core,apps/site}/eslint.a11y.config.js`
  - `{apps/web,packages/core}/jest.a11y.config.js`
  - `{apps/web,packages/core}/src/__tests__/__a11y__/stories.a11y.tsx`
  - `packages/core/src/__tests__/axe.util.ts` and `packages/core/src/__tests__/axe.util.test.tsx`
  - `packages/e2e/src/lib/{a11y-routes,a11y-states,a11y-record}.ts` plus their tests
  - `packages/e2e/src/a11y/{app,site}.a11y.ts`
  - `packages/e2e/src/fixtures/{a11y-error,a11y-running-job}.json`
  - `scripts/a11y-inventory.mjs`
  - `docs/A11Y_AUDIT.md`
- **Edit:**
  - `package.json` (root) and `.gitignore`
  - `{apps/web,packages/core,apps/site,packages/e2e}/package.json`
  - `apps/web/src/__tests__/{setup.ts,test-utils.tsx}` and `packages/core/src/__tests__/setup.ts`
  - `packages/e2e/src/lib/playwright-config.ts`, `packages/e2e/src/__tests__/playwright-config.test.ts`
  - `packages/e2e/README.md` (an "Accessibility audit" section)
- **Not touched:** `.github/workflows/**`, every `eslint.config.js`, every `jest.config.js`.

## Next step

`/plan 792` sequences this into about six TDD slices on `feat/792-a11y-audit`:
1. Inventory generator and self-test, with the doc skeleton and markers.
2. The jsx-a11y report configs and scripts.
3. The jest-axe helper and the stories sweep.
4. The e2e manifest, states and record libraries with their unit tests.
5. The two Playwright projects and specs.
6. The first full `a11y:report` run, the keyboard pass, the screen-reader script handed to the user, and the issue slices.
