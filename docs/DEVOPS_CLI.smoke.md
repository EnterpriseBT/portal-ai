# DevOps CLI (`portalops`) — Manual smoke checklist (#192)

Walk these against your own environments before the retirement step deletes `api-cli.sh`. Prereqs: `aws login` fresh; psql + session-manager-plugin installed (both already validated by the #194 smoke); run from the repo root via `npx portalops …`.

## 1 — Contract basics (no AWS needed)

- [ ] `npx portalops --help` renders both groups; `vars describe` without `--env` exits **2**.
- [ ] `npx portalops vars describe --env nope --json` → exit **3**, `{"error":{"code":"ENV_NOT_CONFIGURED"…}}` on stdout.
- [ ] `npx portalops vars describe --env app-dev` → banner `[env: app-dev (staging)]` on **stderr**, catalog table (17 keys, no values) on stdout.

## 2 — vars against app-dev (live AWS)

- [ ] `vars list --env app-dev` → secrets masked (`abcd…yz (len=N)`), SSM values plain, `AUTH0_CLI_CLIENT_ID` present; `--unmask` reveals; `--json` parses.
- [ ] `vars get AUTH0_DOMAIN --env app-dev` → `portalsai-staging.us.auth0.com` raw on stdout.
- [ ] `vars set` **without** `--yes` → exit **5**; with `--yes` on a harmless key (e.g. re-set `NAMESPACE` to its current value) → succeeds; `~/.portalai/audit.log` gains a `vars set` line with **no value** in it.
- [ ] `vars template --env app-dev` → writes `cloud-vars.app-dev.env` mode **0600**, pre-filled; second run refuses; **delete the file afterwards** (plaintext secrets).
- [ ] `vars apply` the just-templated file with `--yes` → applies all 17 keys (idempotent round-trip), 17 audit lines.

## 3 — db against app-dev

- [ ] `db psql --env app-dev -- -tAc "select 'ok', current_database()"` → `ok|portal_ai` through a fresh tunnel; process exits 0; no orphaned `session-manager-plugin`.
- [ ] `db tunnel --env app-dev` → prints the psql hint, stays attached; Ctrl+C closes cleanly (no orphan).
- [ ] `db seed --env app-dev --yes` → ECS one-off runs to completion (`exitCode: 0`); visible in the ECS console; audit line written.
- [ ] `db reset --env app-dev` **without** `--yes` → exit **5** and *nothing happens*. (Do **not** run reset against app-dev with data you care about — validating the refusal is the point.)

## 4 — db reset against local (the db:reset:hard replacement)

- [ ] With the local stack seeded: `db reset --env local` → drops any `er__*` tables, truncates the rest, leaves `__drizzle_migrations`; `npm run db:seed` afterwards restores system defs (predev flow intact).

## 5 — Guards vs a production-kind env (definition-level, no real prod)

- [ ] Covered by unit tests (prod destructive → 6; prod connect → 5 without `--confirm-prod`); no live prod exists until #83 — mark N/A live.

Sign-off gate: **all boxes above checked → the retirement commit may land** (delete `api-cli.sh` + `reset-hard.ts`, remove the `cli`/`db:tunnel`/`db:reset:hard` scripts, doc-sync).

Signed off on ____________ by ____________.
