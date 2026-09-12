# audit-log — Smoke Suite

Manual smoke test for [#575](https://github.com/EnterpriseBT/portal-ai/issues/575) — the security audit log (append-only store + fail-open emission + owner-gated read API + retention purge). **Branch under test:** `feat/audit-log` (PR [#595](https://github.com/EnterpriseBT/portal-ai/pull/595), into `epic/security-readiness`).

> **Scope note.** This ticket has **no in-app UI** — the activity view is a separate ticket ([#596](https://github.com/EnterpriseBT/portal-ai/issues/596)). Verification is therefore against the **API** and the **DB** (`db:studio` / `psql`), not a browser page. Actions that *produce* audit events are taken in the running app (browser) or via existing endpoints; the resulting rows are inspected in the DB. Most steps are tagged `— manual` for that reason.

## Preflight

### Environment

- [ ] `git checkout feat/audit-log && git pull --ff-only`
- [ ] `npm install`
- [ ] **Apply the migration:** from `apps/api`, `npm run db:migrate` — creates the `audit_log` table **and** the `audit_log_no_mutation` trigger (migration `0094_add-audit-log-table`). Confirm it applied: `psql "$DATABASE_URL" -c "\d audit_log"` shows the table, and `\dy` (or `SELECT tgname FROM pg_trigger WHERE tgrelid='audit_log'::regclass AND NOT tgisinternal`) shows `audit_log_no_mutation`.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).
- [ ] **Auth token for API steps.** Log into the web app (http://localhost:3000) as your dev user, then copy the `Authorization: Bearer …` header from any `/api/…` request in DevTools → Network. Export it: `export TOK="Bearer eyJ…"`. Used for the `/api/organization/audit-log` and `/api/admin/maintenance` calls below.

### Fixtures

- [ ] Your dev user's **current org** (you are its **owner** — org created on first login). Note its id (`/api/organization/current`, or `db:studio` → `organizations`).
- [ ] For the non-owner case (§3): a **second** membership where you are *not* the owner — e.g. via `portalai` CLI add yourself to another org, or seed one. If you can't produce one easily, tag that one step manual-skipped with a reason.

### Reset between runs

- [ ] Audit rows are append-only; a plain `DELETE` is blocked by the trigger. To clear between runs, run in `psql`: `BEGIN; SET LOCAL app.audit_retention_purge='on'; DELETE FROM audit_log; COMMIT;` (this is the same flag the retention purge uses). Otherwise no reset needed — steps are additive.

## §1 — Emission at the security seams (AC1) — manual

Take each action in the running app, then inspect `audit_log` (via `db:studio` → `audit_log`, or `psql "$DATABASE_URL" -c "SELECT action,target_type,target_id,outcome,user_id,source_ip FROM audit_log ORDER BY created DESC LIMIT 20"`).

- [ ] **toolpack.secret.rotate** — in the app, register a webhook toolpack and rotate its signing secret (or `POST /api/toolpacks/:id/rotate-signing-secret`). Expect a row: `action=toolpack.secret.rotate`, `target_type=toolpack`, `target_id=<toolpack id>`, `outcome=success`, `user_id=<you>`. The secret value is **not** in the row.
- [ ] **connector.credential.create** — create a connector instance **with credentials** (e.g. a REST API connector with an auth token). Expect `action=connector.credential.create`, `target_type=connector_instance`. Creating an instance **without** credentials writes **no** credential row.
- [ ] **data.delete** — delete a connector entity in the app. Expect `action=data.delete`, `target_type=connector_entity`, `metadata.cascaded` present.
- [ ] **member.switch** — if you belong to ≥2 orgs, switch orgs. Expect `action=member.switch` recorded **under the org you switched into**, `target_type=organization`.
- [ ] **auth.login** — log out and back in (Auth0 post-login webhook fires). Expect an `action=auth.login` row for your user under your current org. `source_ip`/`user_agent` are null locally unless the Auth0 Action forwards them (deployed-only).
- [ ] **source IP** — for a route-driven row above (e.g. toolpack rotate), `source_ip` is your local socket peer (e.g. `::1`/`127.0.0.1`). It becomes the real client IP in deployed envs only when `TRUST_PROXY_HOPS` is set — see §6.

## §2 — Append-only tamper-evidence (AC2) — manual

- [ ] With at least one row present, attempt a mutation in `psql`: `UPDATE audit_log SET outcome='failure' WHERE id=(SELECT id FROM audit_log LIMIT 1);` → **fails** with `ERROR: audit_log is append-only: UPDATE is not permitted`.
- [ ] `DELETE FROM audit_log WHERE id=(SELECT id FROM audit_log LIMIT 1);` (no flag) → **fails** with `… DELETE is not permitted`.
- [ ] The **flagged** delete works: `BEGIN; SET LOCAL app.audit_retention_purge='on'; DELETE FROM audit_log WHERE id=(SELECT id FROM audit_log LIMIT 1); COMMIT;` → succeeds (this is the only sanctioned delete path — the retention purge).
- [ ] Sanity: there is **no** app route or SDK method that updates or deletes an audit row (`grep -rn "auditLog" apps/api/src/routes` shows only the read; the repository exposes only `append`/`findPage`/`deleteOlderThan`).

## §3 — Owner-gated read API (AC3) — manual

- [ ] **Owner reads the trail:** `curl -s -H "Authorization: $TOK" "http://localhost:3001/api/organization/audit-log" | jq` → `200`, `payload.entries` (newest-first) + `payload.total`. Entries match the rows from §1.
- [ ] **Pagination + filters:** `…/audit-log?limit=1&offset=1` returns 1 entry with the same `total`; `…/audit-log?action=toolpack.secret.rotate` filters to that action; `…/audit-log?outcome=failure` filters by outcome.
- [ ] **Invalid query → 400:** `…/audit-log?sortBy=source_ip` and `…/audit-log?action=org.explode` each return `400` with `code: AUDIT_LOG_INVALID_QUERY`.
- [ ] **Non-owner member → 403:** switch into (or authenticate as a member of) an org you do **not** own, then call `…/audit-log` → `403` with `code: AUDIT_LOG_NOT_AUTHORIZED`. (If you can't produce a non-owner membership, record this step skipped with that reason — it is covered by the integration suite.)
- [ ] **Unauthenticated → 401:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/organization/audit-log` → `401`.

## §4 — Retention past org soft-delete (AC4) — manual

- [ ] In the app (Settings → Delete organization, type-to-confirm), delete an org you own — **or** `DELETE /api/organization/:id` with `{ "confirmationName": "<org name>" }`. Expect `200`.
- [ ] The org is tombstoned (`db:studio` → `organizations`, its `deleted` is set) **but** an `action=org.delete`, `target_type=organization`, `target_id=<org id>` row is present in `audit_log` — i.e. the deletion is itself audited and the row **survives** the tombstone. (`SELECT * FROM audit_log WHERE action='org.delete' AND target_id='<org id>'`.)

## §5 — Fail-open emission (AC5) — manual (hard to force live)

- [ ] Forcing an audit-write failure on a live stack is impractical, so this is primarily covered by the automated integration test (`audit-emission.integration.test.ts` — "delete succeeds even when the audit write throws"). To observe the **signal**: if an audit write ever fails, the API logs `Audit write failed — trail gap` at `error` with an `auditWriteFailures` count, and the audited action still returns success. Confirm the code path by reading `AuditService.record` (a `try/catch` that never rethrows). Record this step verified-by-test.

## §6 — Retention purge + admin surface (AC6) — manual

- [ ] `curl -s -H "Authorization: $TOK" "http://localhost:3001/api/admin/maintenance" | jq '.payload.schedulers'` → includes a scheduler named `audit-log-retention-purge` (pattern `30 5 * * *`).
- [ ] **Optional — force a purge:** insert a row with an old `created` (older than `AUDIT_LOG_RETENTION_MONTHS` × ~30d), then run the processor (a psql-inserted old row + the daily job, or a one-off `tsx` invocation of `auditLogRetentionPurgeProcessor`). Expect the old row gone, recent rows retained, and a `{purged, batches, cutoff}` summary. (Covered deterministically by `audit-log-retention-purge.processor.integration.test.ts`; this step is optional confirmation.)
- [ ] **`TRUST_PROXY_HOPS`** — with it unset (default 0), `source_ip` on route rows is the socket peer; set it to your proxy-chain length only in deployed envs. No local action required beyond noting the default.

## Sign-off

- [ ] Every section above verified (or explicitly recorded as skipped/verified-by-test with a reason).
- [ ] CI green on PR #595 (Static Checks, Unit Tests, Integration Tests, npm audit).
- [ ] <date + name> — confirmed against my own running stack.

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/audit-row/toolpack/connector ids):
