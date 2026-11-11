# OVERHANG_REPLAY_WARNING — Adversarial Review

Adversarial probes for [#1009](https://github.com/EnterpriseBT/portal-ai/issues/1009): replay warnings when a stored plan no longer fits its source, Fit to sheet, and Edit layout with a region whose sheet is gone. **Branch under test:** `feat/1009-overhang-replay-warning` (PR [#1013](https://github.com/EnterpriseBT/portal-ai/pull/1013)).

Probes tagged `— backend` run against the parser, commit service or job redaction directly (a script or a targeted test run), not in a browser. Probes tagged `— manual` need a real Google Sheets / Excel connector.

## Preflight

### Environment
- [ ] On the branch, with the parser and core built; `npm run dev` and the web Storybook (:7007) running.

### Fixtures
- [ ] The Storybook story "Region past its sheet — Fit to sheet (#1009)" and the sync-feedback / notice stories.
- [ ] For `— manual` probes: a Google Sheets connector with a committed plan, as in the smoke doc.

### Reset between runs
- [ ] Reload the story (state is local). Restore the Google sheet for manual probes.

## §1 — Boundary
- [ ] A region whose last row is exactly the sheet's last row, replayed. — No `bounds-overflow`, no warning, and every in-sheet record extracted. — backend
- [ ] 25 regions all past their sheet, replayed and summarized. — Exactly 20 warnings in plan order, `omitted: 5`, and the job-result schema accepts it. — backend
- [ ] A region on a sheet that now has 0 rows and 0 columns. — Replay yields no records and no throw; the drift is `bounds-overflow` at info; the summary entry is well-formed. — backend
- [ ] A region past both the last row and the last column by one line each. — One warning (not two), and the copy names "row N" and "column X" in the singular. — backend

## §2 — Malformed & injection input
- [ ] A sync job result whose `replayWarnings` is malformed (wrong `kind`, missing `bounds`). — The sync feedback falls back to today's green success with the tally; nothing throws. — backend
- [ ] A source sheet named `<img src=x onerror=alert(1)>` that a region runs past. — The warning shows the name as literal text: no element, no request, no script. — backend

## §3 — Concurrency & races — N/A: replay runs inside the sync under the instance's sync lock, and Edit layout already refuses writes while a job holds the connector. The change adds read-only signals and one optional result field, with no new shared state.

## §4 — Auth & permission boundaries
- [ ] A member who can read the sync job but didn't create it reads its result. — `replayWarnings` / `replayWarningsOmitted` are redacted with the rest of `result` (#692 job payload redaction), so sheet names, ranges and entity labels don't reach them. — backend
- [ ] A read-only member sees a warned sync on the connector page. — No "Modify layout plan" link (the edit gate isn't `allow`), and opening the edit route directly still refuses edits server-side. — manual

## §5 — Multi-tenant isolation
- [ ] The commit's entity-label lookup. — It reads only the committed connector instance's entities, so a label never comes from another instance or org. — backend

## §6 — State & lifecycle
- [ ] An entity fed by two regions, one of whose sheets is renamed at the source, then a sync. — The sync completes. The renamed region's warning is shown. Known: that region's old records are reaped because the entity still got records from the other region (#1012), so the copy "weren't refreshed" understates it. Recorded, not a new bug. — backend
- [ ] In Edit layout, Fit to sheet a region, then leave without committing, then reopen. — The stored plan is unchanged (the region overhangs again, with its warning), since nothing is saved before commit. — manual
- [ ] Move an orphaned region onto a sheet smaller than it. — It lands with the overhang warning and PAST SHEET tag, and Interpret refuses it until Fit to sheet. — manual

## §7 — Misuse sequences
- [ ] In the overhang story, click Fit to sheet, then try to click it again. — The second click has nothing to act on (the button is gone with the warning), and the bounds stay at the sheet's last row.
- [ ] Keyboard only: Tab to Fit to sheet and press Enter. — The region is trimmed exactly as with a click; focus stays somewhere sensible (not lost to the page).
- [ ] On a region inside its sheet, drag the bottom-right handle far below the grid and release. — The region ends on the sheet's last row; no new overhang is created and no warning appears.
- [ ] Start a resize on the overhanging region, then release without moving. — The bounds are unchanged and the warning stays (a no-op drag doesn't trim).

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §7 — Keyboard-only Fit to sheet | Trimmed correctly, but focus fell to the page body (the button unmounts with the warning) | low (a11y, focus order) | fixed in-PR: focus moves to the region's bounds caption; re-walked |
| §7 — Press and release on the overhang's handle | The click trimmed the region (the off-grid handle maps to the last row, and pointer-up committed it as a resize) | low | fixed in-PR: an unmoved release isn't a resize; re-walked |
| §6 — Entity fed by two regions, one sheet renamed | The missing region's old records are reaped (its entity still gets records), while the warning says "weren't refreshed" | med (known) | #1012 |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/connector instance/job/entity ids):
