# A11Y_GATES — Adversarial Review

Adversarial probes for [#799](https://github.com/EnterpriseBT/portal-ai/issues/799): accessibility gates in CI (jsx-a11y in `lint` and the component-axe guards in web and core; the story sweep, the Playwright axe walks and the `/smoke-walk` axe audit were removed mid-ticket), plus the fixes they surfaced (code blocks that are regions only while they scroll, distinct code-block names, named accordion regions). **Branch under test:** `feat/799-a11y-gates` (PR [#1018](https://github.com/EnterpriseBT/portal-ai/pull/1018)).

The question here is **how a gate gets bypassed or goes quietly blind**, more than how a user breaks a page. Most probes plant something in the repo, run a command and revert it (`— backend`); browser probes drive the dev stack. "Safe" for a gate means it **fails loudly** on the hostile input. A gate that passes is a finding unless the probe says the escape is deliberate.

## Preflight

### Environment
- [ ] `git checkout feat/799-a11y-gates && git pull --ff-only && npm install && npm run build -w @portalai/core`
- [ ] `npm run dev` (web :3000, API :3001); Playwright MCP available

### Fixtures
- [ ] `e2e-fixture` org seeded, `e2e:auth:all` fresh; the fixture job `b2e823e6-6b59-4a02-9139-89a2ac4aa82c` (51 KB result) and `1b665208-1870-4365-84ab-450b5238700a` (1.7 MB result)

### Reset between runs
- [ ] Every repo probe reverts its own change (`git checkout <file>` / delete the probe). `git status` is clean before the next section.

## §1 — Boundary & limit inputs
- [ ] Open job `1b665208-…` (1.7 MB result). Expected SAFE: the page renders, the Result block is a single named focusable region, Tab reaches it and the page stays responsive (no hang from measuring overflow).
- [ ] On job `b2e823e6-…`, resize the viewport to 320px wide (WCAG reflow), then back to 1280px. Expected SAFE: at 320px the Metadata block overflows and **becomes** a region named "Metadata" with `tabindex="0"`; at 1280px it fits and loses role, name and tab stop again. At no width does a scrolling block lack a tab stop.
- [ ] Narrow a block while it has focus (focus Result, resize so it still overflows, then so it fits if possible). Expected SAFE: focus isn't silently stranded on an element that stops being focusable without the page noticing. If the block stops overflowing while focused, record what happens to focus. — manual

## §2 — Malformed & injection input (tricks against the guards)
- [ ] In `apps/web/src/__tests__/FormAlert.test.tsx`, replace the real axe call with a string literal: `const note = "expectNoAxeViolations(container)";`. Run web's `component-axe.guard`. Expected SAFE: the guard **fails** on `components/FormAlert.component.tsx` (a string isn't a call). Revert. — backend
- [ ] Same file: wrap the axe test in `it.skip(…)`. Run the guard. Expected SAFE: the guard fails, or the gap is recorded as a deliberate limit (a skipped test runs no axe). Revert. — backend
- [ ] Same file: pass `{ disableRules: ["button-name", "label", "aria-dialog-name"] }` to the axe call. Run the guard. Expected SAFE: recorded as the documented escape hatch (a disabled rule needs a reason in review, not in CI), or the guard fails on it. Revert. — backend
- [ ] In a web component, add `{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}` above a `<div onClick>`; run `npm run lint -w @portalai/web`. Expected SAFE: recorded as the documented escape hatch (CLAUDE.md: a disable carries its reason in-file, enforced by review). An unused disable fails lint (`--report-unused-disable-directives`). Revert. — backend
- [ ] In core's `Button.test.tsx`, hide the call after a regex literal holding `/*`: `const re = /a\/*/; await expectNoAxeViolations(container);` with a later `// */`. Run core's guard. Expected SAFE: the call is still seen (no false failure). Revert. — backend

## §3 — Concurrency & races
- N/A — with the story sweep and its turbo task gone, nothing in the remaining gates is cached under a mode flag or run concurrently against shared state; the guards are plain `test:unit` suites.

## §4 — Auth & permission boundaries
- N/A — no route, permission, capability or role surface changes; the gates run in CI and on a developer's machine.

## §5 — Multi-tenant isolation
- N/A — no data access.

## §6 — State & lifecycle abuse
- N/A — the remaining gates hold no state between runs (no result files, no skip lists).

## §7 — Misuse sequences
- [ ] In the Register toolpack dialog, open both reference accordions, switch each through every tab, collapse one, reopen it, reading the accessibility tree after each change. Expected SAFE: every scrolling block stays a named region, and no two regions share a name.
- [ ] Help → Glossary: expand every entry in a category. Expected SAFE: each region is named by its term, and no two share a name.
- [ ] Open the toolpack details for **Financial** (13 blocks), switch to Brand Dark while a code region has focus. Expected SAFE: focus stays on the region, the ring stays visible, and no two regions share a name.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (file / job id / page URL):
