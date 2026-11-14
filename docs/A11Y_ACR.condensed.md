# Accessibility Conformance Report — Condensed design (#800)

**Issue:** [EnterpriseBT/portal-ai#800](https://github.com/EnterpriseBT/portal-ai/issues/800) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791; branch `feat/800-a11y-acr` → `epic/a11y-conformance`.

**Why.** Enterprise buyers ask for a VPAT. With #793–#799 merged, the epic writes its result down: an Accessibility Conformance Report against WCAG 2.2 A and AA, in the VPAT 2.x WCAG-edition layout, as a durable `docs/` reference, plus a documentation-sync row so it stays true. Docs only: no package code changes.

**Scope (PRD gate, recorded on the issue):** the report lives only in `docs/`; the repo is public, so sales shares the link or a PDF export. It covers the web app (SaaS and residency share one codebase; owner, admin and member) and the marketing site. Vendor-hosted pages (Auth0/Google sign-in, Stripe Checkout) are third-party content outside the report.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Evidence log | `docs/A11Y_AUDIT.md` | Last automated run (2026-11-13: 0 findings across jsx-a11y, the story sweep and the route walks), keyboard pass (KB-01…KB-10, all closed) and screen-reader pass (six flows, VoiceOver + NVDA, 2026-11-05, no findings). Its lifecycle line says #800 "folds it into the ACR or deletes it" |
| Gates that run in CI | `CLAUDE.md` → Accessibility Requirements (#799) | jsx-a11y strict in `lint` (web, core, site); `component-axe.guard.test.ts` (web, core); `theme-contrast.test.ts`. No browser axe run since #799 |
| Open evidence gaps | `A11Y_AUDIT.md` KB-09; the walk criteria lists | SR flow 3 steps 3 and 5 (chart alternatives) are "still to walk". Resize, reflow, text spacing and orientation (1.4.4, 1.4.10, 1.4.12, 1.3.4) were never checked |
| Doc-sync table | `CLAUDE.md` → "What changed → what to check" | No accessibility row |
| Durable-doc guards | `scripts/check-doc-pointers.mjs`; `apps/api/src/__tests__/permission-copy.guard.test.ts:132` | An unsuffixed `docs/*.md` is gated: pointers must resolve, and copy must name permissions, not roles |
| Media | `apps/web/src`, `apps/site/src`, `packages/core/src` | No `<video>`, `<audio>` or autoplay, so 1.2.x is Not Applicable |

## Decision — report structure

`docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` follows the VPAT 2.x WCAG edition, in markdown:
1. **Product information:** name, version (the release tag it was evaluated at), report date, contact (the security/contact address the site already publishes).
2. **Scope:** web app and marketing site, as above. The third-party exclusions are named.
3. **Evaluation methods:** jsx-a11y strict in `lint`; jest-axe in every component test, enforced by the guards; `theme-contrast.test.ts`; the keyboard and screen-reader walks (dates, AT and browser versions); and the APG patterns the UI follows (dialog, grid, tabs, menu, accordion). It states there's no browser axe run in CI, so the methods match the gates that actually run.
4. **Terms:** Supports / Partially Supports / Does Not Support / Not Applicable, with the VPAT definitions.
5. **Table 1 — Level A** and **Table 2 — Level AA:** every WCAG 2.2 criterion with a level and remarks. 4.1.1 Parsing is listed as WCAG 2.2 treats it (obsolete; always satisfied). Remarks cite evidence: a gate, a test file, or a walk ID (KB-nn, SR flow/step).
6. **Partially Supports** rows name the limitation and a tracking issue. If one has no issue yet, it's filed during this ticket.

## Decision — fate of `A11Y_AUDIT.md`

Fold or delete, per its lifecycle line. **Decided: keep it as the ACR's evidence log, not fold it in.** Its walk scripts are how the report gets re-verified, and folding them in would bury the buyer-facing statement under test procedure. Its lifecycle line becomes "durable: the ACR's evidence log; re-walk when the ACR's sync row fires". The ACR links to it for every walk citation.

## Decision — keeping it true

There's no guard script: what drifts is semantic (a new interaction, a new page), which no mechanical check sees. Instead, the doc-sync table gains a row: *a new page or route, a new interactive pattern, a change to keyboard/focus/announcement behavior, a new third-party hosted step, or a change to the a11y gates* → re-check the ACR's affected rows, its methods section and its report date. Accessibility Requirements points to the ACR.

## Plan — 2 slices

**Slice 1 — close the evidence gaps** (agent walk via Playwright MCP plus a manual SR walk; writes only `docs/A11Y_AUDIT.md`):
- Walk 1.4.4 (200% zoom), 1.4.10 (320 CSS px), 1.4.12 (text-spacing overrides) and 1.3.4 (portrait/landscape). Cover the dashboard, a list, a detail page, a dialog, the RegionEditor, a portal with a chart, and three site pages, in both themes. Record each as a new `RZ-nn` table in the audit doc. A finding is filed as an issue, cited, and listed as Partially Supports. Fixing it isn't in this ticket.
- SR flow 3, steps 3 and 5 (chart alternatives): a manual VoiceOver + NVDA walk by the user. The result closes KB-09's remark or becomes a Partially Supports row.

**Slice 2 — the report and the sync row:**
- **New:** `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`.
- **Edit:** `CLAUDE.md` (the doc-sync table row; the Accessibility Requirements pointer; the durable-docs list in "Documentation surfaces"); `docs/A11Y_AUDIT.md` (the lifecycle line).
- **Checks:** `npm run lint:doc-pointers`; `npm run test:unit -w @portalai/api -- --testPathPattern permission-copy`, since the API guard scans durable `docs/`.

## Smoke (manual, against your dev stack)

1. Open `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` on GitHub. Tables 1 and 2 list every WCAG 2.2 A and AA criterion, each with a level and non-empty remarks. Count against the W3C WCAG 2.2 quick reference.
2. Every Partially Supports or Does Not Support row names a limitation and links an open issue.
3. The methods section names exactly the gates in `CLAUDE.md` → Accessibility Requirements and says there's no browser axe run in CI.
4. Spot-check three Supports rows' evidence: open the cited test or walk row and confirm it shows what the remark claims.
5. `CLAUDE.md` → "What changed → what to check" has the ACR row, and `A11Y_AUDIT.md`'s lifecycle line no longer says the ACR replaces it.
6. Export the report to PDF (browser print of the GitHub render). The tables stay readable and nothing is cut off. — manual

## Out of scope

- Section 508 / EN 301 549 editions (unless a buyer asks).
- A marketing-site page for the report.
- Fixing anything slice 1 finds: each finding is filed and cited, then fixed under its own ticket.
- Vendor-hosted pages (Auth0, Google, Stripe).
