# tool-usage-ledger — Smoke Suite

Manual smoke test for [#179](https://github.com/EnterpriseBT/portal-ai/issues/179) — the tool usage audit ledger: one `tool_usage_ledger` row per committed tool-call charge, written in the same transaction as the aggregate `usage` increment, idempotent on `tool_call_id`; an org-facing itemized read (`GET /api/organization/usage/ledger` + the Settings "Itemized usage" dialog); and the codebase's first repeatable maintenance job (daily retention purge, `LEDGER_RETENTION_MONTHS`) with operator visibility via `GET /api/admin/maintenance`.

**Branch under test:** `feat/tool-usage-ledger` (PR [#221](https://github.com/EnterpriseBT/portal-ai/pull/221) into `epic/subscription-billing`).

Run **§Preflight** once before any section. §1–§5 can be walked top-to-bottom and are independent after preflight; **§6 (org delete) is destructive — run it last, against a scratch org.**

Acceptance-criterion "all tests pass + lint/type-check clean" is CI's half of the merge gate, not a walkthrough step here.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/tool-usage-ledger && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — new `ToolUsageLedgerEntry` model + `usage-ledger` / `maintenance` contracts; the API and web need the rebuilt core dist.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — migration `0070_create_tool_usage_ledger.sql` creates the table + FULL unique on `tool_call_id` + `(organization_id, period_id)` index + CHECKs. Confirm it applies cleanly.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). API log shows **"Maintenance schedulers registered"**.
- [ ] Redis reachable; no BullMQ retry errors in the API log (a second worker — the maintenance worker — now attaches alongside the jobs worker).
- [ ] Auth0 dev tenant works — login lands on `/dashboard`.

### Tool sanity

- [ ] The station under test has a **metered built-in tool** available — `web_search` (Tavily key configured) is the reference; `transform_entity_records` (expensive, job-deferred) is needed for §2.
- [ ] `http://localhost:3001/api-docs` lists `GET /api/organization/usage/ledger` (with `periodId`/`toolName`/`sortBy` params) and `GET /api/admin/maintenance`.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **org-main** | Your normal dev org, on a tier with a metered allocation (standard: 1000 metered units). | §1–§5 |
| **entity-small** | Any connector entity with a few rows + a portal session on its station — the `transform_entity_records` target for §2. | §2 |
| **org-scratch** | A throwaway org you own (create via the app or `portalai` CLI) — deleted in §6. | §6 |

- [ ] `npm run db:studio` (from `apps/api/`) open — you'll inspect `tool_usage_ledger` and `usage` side by side throughout.

### Reset between runs

- [ ] No reset needed for §1–§3 and §5 (the ledger is append-only; re-runs just add rows). For §4's quota case, restore the org's allocation afterwards by deleting the period's `usage` rows for the test org (dev-only surgery) or switching tiers back.

---

## §1 — Write path: one row per committed charge, sums match (spec AC 2)

- [ ] In a portal session on org-main, prompt: **"Search the web for the latest news about the James Webb telescope."**
- [ ] The agent calls `web_search` and answers normally (the gate is invisible on the happy path).
- [ ] In `db:studio` → `tool_usage_ledger`: **exactly one new row** — `tool_name = web_search`, `cost_class = metered`, `units ≥ 1`, `tool_call_id` set (AI SDK id), `station_id` = the session's station, `portal_id` = the portal, `user_id` = your user id, `period_id` = the current billing period.
- [ ] In `usage`: the org's `metered` row for the same `period_id` incremented by exactly that row's `units`.
- [ ] Run 2–3 more metered calls, then verify the sums match: `SELECT SUM(units) FROM tool_usage_ledger WHERE organization_id='<org>' AND period_id='<period>' AND cost_class='metered'` equals `usage.units_used` for that `(org, period, metered)` row.
- [ ] Settings → Organization → "Metered usage" shows the same used total.

## §2 — Deferred charge: `job:<jobId>` row from a transform (spec AC 4)

- [ ] In a portal session, prompt a bulk transform against entity-small (e.g. **"Uppercase the name field on every record"** — whatever produces a `transform_entity_records` job).
- [ ] Wait for the job to complete (toast / job list).
- [ ] `tool_usage_ledger` gains **one** row: `tool_name = transform_entity_records`, `tool_call_id = job:<jobId>` (match the `jobs` row id), `cost_class = expensive`, `station_id`/`portal_id` populated from the job metadata.
- [ ] Idempotency spot-check: the FULL unique means a retried processor can't double-ledger. Verify in `db:studio` there is exactly **one** row for that `job:<jobId>` even if the job row shows `attempts > 1`.

## §3 — Read path: endpoint + Settings drill-down (spec AC 5)

### §3a — Settings dialog

- [ ] Settings → Organization tab → Subscription & Usage section shows an **"Itemized usage"** button.
- [ ] Click it: a dialog opens listing the §1/§2 rows — columns Tool / Class / Units / When / Who, newest first, with a **"Period <current>"** chip (current billing period is the default filter).
- [ ] Delete the period chip: the list now spans all periods (same rows in a fresh org, but the chip disappears and the empty-state copy changes if you filter into an empty period).
- [ ] Pagination: with > 10 rows, page 2 works and the count ("1–10 of N") matches the DB row count.

### §3b — API contract

- [ ] `GET http://localhost:3001/api/organization/usage/ledger?limit=2&offset=0` (with your Bearer token) → `{ entries: [...], total: N }`, newest-first, `total` independent of `limit`.
- [ ] `...?toolName=web_search&periodId=<current>` filters correctly.
- [ ] `...?sortBy=portalId` → **400** `USAGE_LEDGER_INVALID_QUERY` (allow-map is `created|units|toolName`).
- [ ] No token → **401**. (Org isolation — another org's rows never appearing — is pinned by the integration suite; spot-check by switching orgs in the app if you have two.)

## §4 — No-row cases (spec AC 3)

- [ ] **Free call**: prompt something that uses a free tool (e.g. `current_time` via **"What time is it?"**). No new `tool_usage_ledger` row, no `usage` change.
- [ ] **Failed call**: make a metered tool fail (e.g. temporarily unset the Tavily key and prompt a web search). The agent surfaces the failure; **no** ledger row, **no** charge (bill-on-success).
- [ ] **Org-paid (custom/webhook) tool**: if you have a custom toolpack registered, call one of its tools — no ledger row, no charge (`resolveCallCost` = 0 for org-hosted).
- [ ] **Quota-exceeded skip**: on a tier with a small metered allocation (or after burning the allocation), a call that would exceed it is denied/skipped — the denial is a typed tool result and **no ledger row appears** (a skipped charge writes nothing).

## §5 — Retention purge + admin visibility (spec AC 6, 7)

- [ ] `GET http://localhost:3001/api/admin/maintenance` (Bearer token) → `schedulers` contains `{ id: "ledger-retention-purge", pattern: "0 4 * * *", next: <future ms> }`; `recentRuns` is empty on a fresh stack.
- [ ] Restart the API and call it again — still exactly **one** scheduler entry (upsert-by-id; double-boot doesn't duplicate).
- [ ] Live purge demo: stop the dev stack, set `LEDGER_RETENTION_MONTHS=0` in `apps/api/.env`, restart. Then trigger a run without waiting for 04:00 UTC — from `apps/api/`:
  ```bash
  npx tsx --env-file=.env -e "const m = await import('./src/queues/maintenance.queue.ts'); await m.maintenanceQueue.add(m.LEDGER_RETENTION_PURGE_JOB, {}); await m.maintenanceQueue.close();"
  ```
- [ ] API log shows "Ledger retention purge started/finished"; every `tool_usage_ledger` row older than the (now-zero) window is gone; `usage` rows are untouched.
- [ ] `GET /api/admin/maintenance` → `recentRuns[0]` is the run with `returnvalue: { purged: <n>, batches: <b>, cutoff: <iso> }` matching what was deleted.
- [ ] Restore `LEDGER_RETENTION_MONTHS=24` (or remove the line) and restart — the window is env-driven, no code change.

## §6 — Org delete retains the ledger (spec AC 8) — destructive, run last

- [ ] Switch to **org-scratch**, run one metered call (so it has a ledger row; note the org id).
- [ ] Settings → Organization → Danger zone → Delete organization (type-to-confirm) — the delete succeeds and logs you out.
- [ ] In `db:studio` (or psql): the org row is soft-deleted (tombstone), but its `tool_usage_ledger` row(s) are **intact and not soft-deleted** — same retention posture as `usage`.

---

## Sign-off checklist

After every section above is green:

- [ ] §1 (write path) — one row per committed charge; ledger sum equals the aggregate balance.
- [ ] §2 (deferred) — `job:<jobId>` row, exactly one even across retries.
- [ ] §3 (read path) — Settings dialog + endpoint filters/pagination/400/401.
- [ ] §4 (no-row cases) — free / failed / org-paid / quota-skip all write nothing.
- [ ] §5 (retention) — scheduler visible + idempotent; env-driven purge runs, reports `{ purged, batches, cutoff }`.
- [ ] §6 (org delete) — ledger rows survive the cascade.
- [ ] <date + name> — confirmed against my own running stack.

After every box ticked: report ready-to-merge in the PR thread, or file follow-up bugs against any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <agent transcript, screenshots, db row inspections>
**Repro:** <prompt + any preconditions>
**Org / job / tool_call_id:** <from db:studio>
```
