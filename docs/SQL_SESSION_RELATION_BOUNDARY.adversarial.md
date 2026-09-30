# SQL session relation boundary, PR 2 — Adversarial Review

Adversarial probes for [#660](https://github.com/EnterpriseBT/portal-ai/issues/660), PR 2. Agent SQL, map tiles and dissolve now run under the restricted NOLOGIN reader role (`SET LOCAL ROLE`, SELECT granted per session on the session's temp views). The SQL tools refuse with `PORTAL_SQL_UNAVAILABLE` when the role isn't usable, and an optional `MIGRATE_DATABASE_URL` provisions the role for the app user. **Branch under test:** `fix/660-sql-reader-role` (PR [#662](https://github.com/EnterpriseBT/portal-ai/pull/662)). This is the adversarial gate deferred from PR 1 (#661).

These probes attack **the role layer**: how it's configured, how it behaves across pooled connections and concurrent tenants, what happens when it changes under a running API, and how migrations handle it. Tags: untagged = agent-walkable in the browser; `— backend` = psql / curl / a script against the local stack; `— manual` = needs a human or a real cluster.

## Preflight

### Environment

- [ ] On `fix/660-sql-reader-role`, `npm install`, `cd apps/api && npm run db:migrate` (0118), `npm run dev`. Confirm the API process started after the branch's last commit, and that the boot log shows `portal-sql.reader-role-ok`.
- [ ] e2e identities (`e2e:auth:all`); the member bearer from the storageState for curl probes.
- [ ] A second API on `:3011` for probes that change the role's configuration (`PORT=3011 … npx dotenv -e .env -- tsx src/index.ts`), so `:3001` stays on the real role.

### Fixtures

- [ ] The SMOKE-660 fixture (see the smoke doc's §Fixtures): `smoke660_parcel_geo` granted to the member, `smoke660_parcels_full` not, another org's `smoke660_secret`, and Pins A (valid) and B (raw `er__`).
- [ ] For §3 and §5: a **second member** of the e2e org (or the admin), with a *different* grant, `smoke660_parcels_full` only.

### Reset between runs

- [ ] Every throwaway role or database a probe creates is named `*_adv660*` and is dropped at the end of its step (`REVOKE ALL ON SCHEMA public FROM …` first). Re-seed SMOKE-660 and remove it afterwards.

## §1 — Boundary & limit inputs (operator configuration)

- [ ] — backend. `:3011` with `PORTAL_SQL_READER_ROLE` set to a name that isn't a plain lower-case identifier (upper case, a quote, a space, 64+ characters). Safe: boot logs `reader-role-unavailable` with an "invalid PORTAL_SQL_READER_ROLE" reason; SQL tools and tiles return 503; no SQL is built from the name.
- [ ] — backend. `:3011` with `PORTAL_SQL_READER_ROLE=postgres` (a superuser). Safe: refused, reason "is a superuser or bypasses row security". Never runs agent SQL as it.
- [ ] — backend. `:3011` with `PORTAL_SQL_READER_ROLE` set to the **API's own login role**. Safe: refused, because that role can read application tables ("can read public.…").
- [ ] — backend. A station whose session has many views (attach 50+ curated views to a test station and grant them). Safe: a member query still succeeds, with one GRANT per view and no error or timeout from the per-session grants.

## §2 — Malformed & injection input — N/A

N/A: PR 2 adds no new user-controlled input. Agent SQL is still gated by PR 1's parser (walked in the smoke doc's §2–§3 and on #661). The role name and grantee are operator configuration, covered in §1 and §7.

## §3 — Concurrency & races (pooled connections)

- [ ] — backend. Fire 20 interleaved `runSqlQuery` calls in parallel (a script using the service, or 20 concurrent tile requests): half as the member (granted `smoke660_parcel_geo` only), half as the second member (granted `smoke660_parcels_full` only). Each asks for the view the *other* user holds. Safe: every call gets only its own user's views. The other view is `unknown entity` or `permission denied`, never data. No pooled connection carries one user's grants or role into another's session.
- [ ] — backend. Force an error mid-session (a query that fails at execution, e.g. division by zero), then immediately run a query on the same pool as the owner-side code path (e.g. a normal API list endpoint that reads `entity_records`). Safe: the second query succeeds as the API role. `SET LOCAL ROLE` ended with the rolled-back transaction, so no connection is left stuck on the reader role or on read-only.
- [ ] — backend. Run a dissolve precompute (Pin A) while firing tile requests for the same pin. Safe: tiles serve (200 or 204) throughout. Dissolve completes. No tile transaction runs as the owner, and no dissolve write happens under the reader role.

## §4 — Auth & permission boundaries

- [ ] — backend. With `:3001` running (success cached), `GRANT SELECT ON entity_records TO portalai_sql_reader` in psql, then run a member query that names `entity_records`. Expected: the PR 1 gate still rejects it (`unknown entity`). **Record the known limitation:** the cached success isn't re-checked until restart, so a later over-grant is caught only at the next boot (confirm `:3011` booted now refuses). Revoke afterwards.
- [ ] — backend. With `:3001` running (success cached), `REVOKE portalai_sql_reader FROM <app user>` in psql, then a member query and a tile request. Safe: the request fails with a clean error (the `SET ROLE` is denied). It **never** runs the SQL as the app user and never returns data. Re-grant afterwards (`GRANT … WITH SET TRUE`).
- [ ] — backend. PG16+: grant the role to a test login user **without** SET (`GRANT portalai_sql_reader_adv660 TO adv660_app WITH SET FALSE`), and start `:3011` as that user. Safe: refused (`SET ROLE` fails in the probe). Clean up.

## §5 — Multi-tenant isolation

- [ ] — backend. After a batch of member sessions from **two orgs** (the e2e org and another seeded org with its own station and view), list every privilege the shared reader role holds outside temp schemas: `SELECT … FROM pg_class … WHERE has_table_privilege('portalai_sql_reader', oid, 'SELECT')`. Safe: only extension-owned tables. No temp view of one session, and no org's table, is readable by the role afterwards.
- [ ] — backend. Two orgs' members query at the same moment (parallel curl tile requests for each org's pin). Safe: each gets only its own org's geometry. Tile byte sizes and features match what each gets when run alone.

## §6 — State & lifecycle abuse

- [ ] — backend. With `:3001` running (success cached), `DROP ROLE portalai_sql_reader` (revoke first). Then a member query. Safe: a clean error, never the query running as the app user. After re-running 0118 (`npm run db:migrate` is a no-op, so apply the file with psql), the next query works.
- [ ] — backend. Restore-from-backup shape: a fresh database from a `pg_dump` of the dev DB (roles aren't in a dump), pointed at a cluster where the role doesn't exist, with `:3011` using it. Safe: refused (`does not exist`) until 0118 is re-applied. `db:upgrade` alone doesn't re-create it, because the migration is already journaled. **Record** that operators must re-run the role provisioning after a cross-cluster restore (README).
- [ ] — backend. `GRANT SELECT ON users TO PUBLIC` in psql (a hardened-DB misconfiguration), then restart `:3011`. Safe: the probe refuses ("can read public.users"). Revoke afterwards.
- [ ] — backend. Re-run 0118 three times, as the superuser and then as a non-CREATEROLE user. Safe: idempotent. No duplicate grants, no failure, and membership still only for the grantee.

## §7 — Misuse sequences (operator)

- [ ] — backend. `MIGRATE_DATABASE_URL` set equal to `DATABASE_URL`. Safe: migrations succeed; provisioning runs as the same user (a no-op when it already holds the role).
- [ ] — backend. A `MIGRATE_DATABASE_URL` whose password is wrong. Safe: `db-migrate` exits non-zero with an authentication error *before* any schema migration runs. It doesn't silently skip provisioning and report success.
- [ ] — manual. Helm with `postgresql.external.migrationPassword` containing URL-special characters (`@`, `/`, `:`). Safe: the migration job fails clearly (a connection or URL parse error); it doesn't connect to the wrong host or user. The README says the password must be URL-safe. **Record** whether the chart should URL-encode it instead.
- [ ] — backend. `helm template` with `existingSecret` set (the operator-managed app Secret) plus an inline `migrationPassword`. Safe: the migration password lands only in `<release>-portalai-migrate`, never in the operator's app Secret or the API Deployment's env.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids, role names):
