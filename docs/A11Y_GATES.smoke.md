# a11y_gates — Smoke Suite

Smoke test for [#799](https://github.com/EnterpriseBT/portal-ai/issues/799): accessibility gates in CI. jsx-a11y strict fails `lint`, axe over every story fails Unit Tests, a component-axe guard in web and core fails any component test that skips axe, and `/smoke-walk` audits every page it walks. Also covers the fixes the gates surfaced: themed, scroll-aware code blocks, `Progress`'s name, and the invitations table's header.

**Branch under test:** `feat/799-a11y-gates` (PR [#1018](https://github.com/EnterpriseBT/portal-ai/pull/1018)), base `epic/a11y-conformance`.

Run **§Preflight** once. After that the sections are independent. Steps tagged `— backend` run a command in the repo rather than the browser (a planted violation, a test run, the report): the agent runs them and records the output, and `/smoke-walk` reports them `could-not-automate`. Untagged steps are browser steps `/smoke-walk` drives. Every planted change is reverted in its own section (`git status` clean afterwards).

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, linking this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/799-a11y-gates && git pull --ff-only`
- [ ] `npm install && npm run build -w @portalai/core`: web reads core's `dist`, and this branch changes core's theme (`palette.code`, `codeBlockRules`) and `Progress`. No migration.
- [ ] `npm run dev` boots cleanly (web :3000, API :3001).
- [ ] For §6: the marketing site is built and previewed on :3002 (`npm run build -w @portalai/site && npm run preview -w @portalai/site`).

### Fixtures

- [ ] The e2e fixture org is seeded and the sessions are fresh: `npm run --workspace @portalai/e2e e2e:seed`, then `e2e:auth:all`. The owner's active org is `e2e-fixture` (`f01f20fe-…`).
- [ ] A completed job with a large result exists in the fixture org, so its Result block scrolls. Locally that's `b2e823e6-6b59-4a02-9139-89a2ac4aa82c` (51 KB result). Any completed sync or import works.

### Reset between runs

- [ ] Nothing persists: every planted file or edit below is removed in its own section. `git status` must be clean before sign-off.

---

## §1 — Code blocks: themed, named and focusable while they scroll (slice 1, review fix)

- [ ] Open **http://localhost:3000/jobs/b2e823e6-6b59-4a02-9139-89a2ac4aa82c** (Brand theme).
- [ ] The **Result** block is a region named "Result" (accessibility tree: `region "Result"`) with `tabindex="0"`. Tab to it: it takes focus and shows the 2px focus ring; the arrow keys scroll it.
- [ ] The **Metadata** block, if it fits without scrolling, is **not** a region and has no `tabindex`. If it scrolls, it is a region named "Metadata".
- [ ] Run the §5 audit snippet on this page: **0 violations**. In particular no `color-contrast` on `.hljs-*` tokens and no `scrollable-region-focusable`.
- [ ] Switch to **Brand Dark** (header theme switcher) and run the audit again: **0 violations**; the code tokens are legible on the dark code background.
- [ ] Code-token colours look intentional in both themes (keywords, strings, numbers and comments are distinct; comments are italic) — manual

## §2 — Toolpack code blocks are named distinctly (review fix)

- [ ] Open **http://localhost:3000/toolpacks**, open the details of a built-in toolpack with several tools (e.g. its metadata button).
- [ ] Each scrolling code block's region name includes its tool: `"<tool name> parameters"`, and examples read `"<tool name>, <example title> input"` / `"… output"`. No two regions in the dialog share a name.
- [ ] The §5 audit on the open dialog: **0 violations** (no `landmark-unique`).
- [ ] Open **Register toolpack**, expand **See expected request / response shapes per endpoint** and **See how to verify our signed requests on your server**, both on the same language tab. Any scrolling block is named `"Endpoint shapes, <language>: …"` or `"Signature verification, <language>: …"`; the audit reports **0 violations**. Close without saving.

- [ ] Open **http://localhost:3000/help?tab=faq** and expand two entries (then the Glossary tab, two entries). Each entry's region is named by its question or term, and the audit reports **0 violations** (no `landmark-unique`).

## §3 — Components the gates fixed (slices 4–5)

- [ ] **Settings → Members** with at least one pending invitation (if none, invite `smoke-799@example.com`, then revoke it after this step). The pending-invitations table's last column header has the accessible name **"Actions"** (visually hidden). Audit: **0 violations** (no `empty-table-header`).
- [ ] Any `Progress` bar on screen (a running sync on a connector, or the file-upload step) is a `progressbar` with an accessible name ("Progress" by default). If no job is running, this is covered by core's `Progress.test.tsx` and the story sweep — note which you observed.

## §4 — The lint gate (slice 2)

- [ ] `printf 'export const X = () => <div onClick={() => {}} />;\n' > apps/web/src/components/ZzLintProbe.component.tsx && npm run lint -w @portalai/web` **fails**, naming `jsx-a11y/click-events-have-key-events` and `jsx-a11y/no-static-element-interactions` in that file. Delete the file. — backend
- [ ] The same probe as `packages/core/src/ui/ZzLintProbe.tsx` fails `npm run lint -w @portalai/core`. Delete it. — backend
- [ ] `printf -- '---\n---\n<img src="/x.png">\n' > apps/site/src/pages/zz-lint-probe.astro && npm run lint -w @portalai/site` **fails** on `jsx-a11y/alt-text`. Delete it. — backend
- [ ] With the probes gone, `npm run lint` passes in all three packages. — backend

## §5 — `/smoke-walk` audits every page (slice 7, review fix)

The audit snippet is the block between the `axe-tags` markers in `.claude/skills/smoke-walk/SKILL.md`, run verbatim through `browser_run_code_unsafe`.

- [ ] On **http://localhost:3000/** run the snippet: it returns `[]`.
- [ ] Plant a violation (`browser_evaluate`: append an empty `<button id="planted">` to `main`), run the snippet: it returns `["button-name · critical · #planted"]`. Under the skill's rules that step is a **mismatch**. Remove the button.
- [ ] `npm run test:unit -w @portalai/e2e -- --testPathPattern smoke-walk-axe` passes: the snippet's `TAGS` equal `AXE_TAGS`. — backend

## §6 — The story gate, the component guard, and the report (slices 3–7)

- [ ] Plant a story `apps/web/src/stories/ZzGateProbe.stories.tsx` with one story rendering `<button type="button" />` and one that throws. `npm run a11y:stories` **fails**, and the failure lists both: `…ZzGateProbe.stories.tsx#<story>: button-name` under `violating` and `…#<story>: <error>` under `unlistedSkips`. — backend
- [ ] `A11Y_REPORT_ONLY=1 npm run a11y:stories -w @portalai/web` **passes** with the probe present, and `apps/web/a11y-results/stories.json` records both runs. Delete the probe. — backend
- [ ] In `apps/web/src/__tests__/FormAlert.test.tsx`, comment out the `expectNoAxeViolations` call. `npm run test:unit -w @portalai/web -- --testPathPattern component-axe.guard` **fails** on `components/FormAlert.component.tsx`. Restore the file. — backend
- [ ] In `packages/core/src/__tests__/ui/Button.test.tsx`, do the same: core's guard fails on `ui/Button.tsx`. Restore it. — backend
- [ ] `npm run a11y:report` exits 0 end to end, and `docs/A11Y_AUDIT.md` reads **"No automated findings."**, with every input row dated within one run. `git diff docs/A11Y_AUDIT.md` shows only timestamps and counts. — backend
- [ ] On PR #1018, `Static Checks`, `Unit Tests` (including the "Check the a11y inventory script" and "Run axe over every story" steps), `Integration Tests` and `E2E Tests` are green on the head commit. — backend

## §7 — Docs

- [ ] `CLAUDE.md` → "Accessibility Requirements" lists the four gates and says the Playwright walks are report-only by design; "CI gating" names the two Unit Tests steps; the dialog checklist's axe line names `component-axe.guard.test.ts`. `packages/e2e/README.md` and `docs/A11Y_AUDIT.md`'s preamble agree. — manual

---

## Sign-off

- [ ] Every section above verified
- [ ] `git status` clean (every probe removed)
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / job / page URL, axe rule + target):
