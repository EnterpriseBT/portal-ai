# A11Y_TOOLING_AUDIT — Adversarial Review

Adversarial probes for [#792](https://github.com/EnterpriseBT/portal-ai/issues/792): the report-only accessibility tooling (jsx-a11y report, jest-axe stories sweep, axe walks of the app and the marketing site), and the generator that writes `docs/A11Y_AUDIT.md`. **Branch under test:** `feat/792-a11y-audit` (PR [#967](https://github.com/EnterpriseBT/portal-ai/pull/967)).

This change ships no app UI and no API. Its threat model is a report that **lies**: it reads as more conformant, or more complete, than the code is. A report like that would mislead the area children (#793–#798), the gates (#799) and the ACR a buyer reads (#800).
- **The safe behavior is always the same:** a setup problem fails loudly, and a gap shows as a gap, never as a clean result.
- **A second risk:** the walk writing, or reaching, outside the local fixture org.

Most probes run the scripts against hostile inputs and states, so they're tagged `— backend`. The untagged ones a browser session can drive.

## Preflight

### Environment
- [ ] `git checkout feat/792-a11y-audit && npm install`, dev stack up (web :3000, API :3001), `npm run db:migrate -w @portalai/api`
- [ ] The site is built and previewed on :3002: `npm run build -w @portalai/site && npm run preview -w @portalai/site`

### Fixtures
- [ ] The `e2e-fixture` org is demo-seeded: `npx portalai demo seed --org <id> --rows 2000 --env local --yes`
- [ ] `npm run e2e:auth:all -w @portalai/e2e` has been run, and every identity's active org is `e2e-fixture`
- [ ] One clean `npm run a11y:report` has run. Copy `docs/A11Y_AUDIT.md` and every `*/a11y-results/` aside as the baseline

### Reset between runs
- [ ] Restore the baseline `a11y-results/` files and `git checkout docs/A11Y_AUDIT.md`, then confirm `npm run a11y:inventory` reproduces it byte-for-byte

## §1 — Boundary & limit inputs
- [ ] Replace `apps/web/a11y-results/eslint.json` with `[]` (a lint run that linted nothing), then `npm run a11y:inventory`. Expected SAFE: exit 1 naming that file ("no successful run … an empty result isn't a clean one"), and `docs/A11Y_AUDIT.md` unchanged. — backend
- [ ] Set every run in `packages/e2e/a11y-results/app.json` to `"status": "skipped"`. Expected SAFE: exit 1 naming the file. No doc written with zero app findings presented as clean. — backend
- [ ] Delete `packages/e2e/a11y-results/site.json` and run the inventory. Expected SAFE: exit 1 naming the missing file and the command that writes it; the doc unchanged. — backend
- [ ] Put a 10,000-character selector into one violation target in `app.json`. Expected SAFE: the inventory writes. The row stays one table row (no line break splits it), and every other row is intact. — backend

## §2 — Malformed & injection input
- [ ] Truncate `apps/web/a11y-results/stories.json` mid-object (invalid JSON). Expected SAFE: exit 1, `stories.json isn't valid JSON`, the doc unchanged. — backend
- [ ] Put a violation target of ``td | <script>alert(1)</script> `x` [y](javascript:alert(1))`` into `app.json`, regenerate, and view `docs/A11Y_AUDIT.md` on GitHub (the PR's file view). Expected SAFE: the pipe is escaped, so the table keeps its columns. The script and link render as inert text, with nothing executable or clickable. — manual
- [ ] Add a message with `"ruleId": "jsx-a11y/made-up-rule"` to `apps/web/a11y-results/eslint.json`. Expected SAFE: exit 1 naming the rule and pointing at `JSX_A11Y_WCAG`. No row written with an empty criterion. — backend
- [ ] Add a message `{ "ruleId": null, "fatal": true, "message": "Parsing error" }` to `eslint.json`. Expected SAFE: exit 1 naming the file and line. Then the same with `"fatal"` removed and `"severity": 1` (an unused-disable warning). Expected SAFE: the inventory writes and adds no row for it. — backend
- [ ] Edit `src/fixtures/a11y-running-job.json` so `"status": "completed"` and `"progress": "forty"`, then `npm run a11y:axe -w @portalai/e2e`. Expected SAFE: the locked state fails to load its fixture (JobSchema parse error), each locked run is recorded as skipped with that reason, and no locked state is recorded `ok`. — backend
- [ ] Give a seeded record a display name containing an email and a phone number. Re-run the walk and the inventory, then grep `docs/A11Y_AUDIT.md` for them. Expected SAFE: absent. Node HTML is trimmed, so only selectors are recorded. **Note:** a selector built from an `alt` or `aria-label` value can still carry text (see the security review's below-bar note), so record what you see. — backend

## §3 — Concurrency & races
- [ ] Start `npm run a11y:axe -w @portalai/e2e`, and while it runs, run `npm run a11y:inventory` twice. Expected SAFE: each inventory run either uses the previous complete `app.json` or fails cleanly on an unreadable one. `app.json` is written once, in `afterAll`. The doc is never written from a half-written results file. — backend
- [ ] Start `npm run a11y:report` twice at once in two terminals. Expected SAFE: both finish or one fails, and the final `docs/A11Y_AUDIT.md` equals a single clean run's output (re-run `a11y:inventory` and diff). — backend

## §4 — Auth & permission boundaries
- [ ] `E2E_A11Y=1 E2E_TARGET=app-dev npx playwright test --list` in `packages/e2e`. Expected SAFE: only the `login` project is listed. Neither `a11y` nor `a11y-site` exists for a deployed target, so no QA identity walks app-dev or prod. Repeat with `E2E_TARGET=prod`. — backend
- [ ] Run a bare `npm run test:e2e -- --list -w @portalai/e2e` (no `E2E_A11Y`). Expected SAFE: no `a11y` or `a11y-site` project, so the walk can't start by accident. — backend
- [ ] During a full `npm run a11y:axe`, record every request to `:3001` (API request log, or a Playwright `page.on("request")` probe). Expected SAFE: only GET (plus OPTIONS preflight). No POST, PATCH, PUT or DELETE reaches the API, because the walk never writes as any role. — backend
- [ ] Revoke the member session (delete `.auth/member.storageState.json`, or let it expire), then `npm run a11y:axe -w @portalai/e2e`. Expected SAFE: the member test fails naming `npm run e2e:auth:all`. It doesn't walk `/login` and record it as every route's member state. — backend

## §5 — Multi-tenant isolation
- [ ] Switch the admin identity's active org to a second org it belongs to (`POST /api/organization/switch`), then run the walk. Expected SAFE: the second org's pages are visited read-only, and the divergence is **visible**: the admin's drills land on different ids, and any route with no data there shows as a skip in Coverage. The admin's results are never silently presented as the fixture org's. Then switch back. — backend

## §6 — State & lifecycle abuse
- [ ] Re-run only `npm run a11y:lint -w @portalai/web` after editing a component, and leave the stories and walk results from yesterday. Then `npm run a11y:inventory`. Expected SAFE: the doc shows that its inputs come from different runs (each result file's generation time, or an equivalent staleness signal in Coverage). A mixed-generation inventory shouldn't read as one coherent audit. — backend
- [ ] Add a new route file `apps/web/src/routes/a11y-probe.tsx` (any `createFileRoute`) without adding it to `A11Y_ROUTES`, then `npm run test:unit -w @portalai/e2e`. Expected SAFE: `a11y-routes.test.ts` fails naming the uncovered route. Delete the file afterwards. — backend
- [ ] Stop the API mid-walk (kill the `tsx src/index.ts` process). Expected SAFE: the remaining runs are recorded as skipped with an error, and the walk's `afterAll` still writes `app.json`. Then the inventory either regenerates with those gaps listed, or the walk exits non-zero. Never a doc showing those routes as clean. — backend
- [ ] Rename `/api/organization/current` in the manifest's settings states to `/api/organization/currant` and run the walk. Expected SAFE: Settings' error and loading runs are recorded as skipped with "no request matched … never entered the error state". They're never `ok`. — backend

## §7 — Misuse sequences
- [ ] Hand-edit a row inside the generated section of `docs/A11Y_AUDIT.md` (for example, delete a #797 row), then `npm run a11y:inventory`. Expected SAFE: the hand edit is overwritten by the regenerated section, and the hand-written Keyboard and Screen-reader sections outside the markers are byte-identical. — backend
- [ ] Delete the `<!-- a11y-inventory:end -->` marker, then run the inventory. Expected SAFE: exit 1 about the markers, and the doc is not rewritten or truncated. — backend
- [ ] In the hand-written findings table, add `| SR-99 | Sign-in | 1 | 4.1.2 | test | NVDA | #7977 |` (owner typo), then regenerate. Expected SAFE: it's counted under **Unassigned** in the Summary, not silently dropped or credited to #797. — backend
- [ ] Run `npm run a11y:axe:site -w @portalai/e2e` with no preview running. Expected SAFE: fails naming `astro preview` and the URL, and writes no `site.json` with zero runs presented as clean. — backend

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
