# App-admin CLI (`portalai`) — Manual smoke checklist (#190)

The epic-closing walkthrough. Prereqs: `aws login` fresh; a device-flow login for app-dev (`portalai login --env app-dev`); a disposable local DB; run via `npx portalai …` from the repo root (`DATABASE_URL` in the shell env for `--env local`).

## 1 — Contract basics

- [ ] `npx portalai --help` renders all groups; `org list` without `--env` exits **2**.
- [ ] `org get nope --env app-dev --json` → exit **8**, `{"error":{"code":"ADMIN_NOT_FOUND"…}}`.
- [ ] Banner `[env: … (kind)]` on stderr; `--json` payload alone on stdout.

## 2 — The session requirement

- [ ] With **no** device-flow session: `org update … --env app-dev --yes` → exit **4**, message names `portalai login --env app-dev`.
- [ ] `portalai login --env app-dev` → approve the printed URL → mutations now work; `~/.portalai/audit.log` lines carry your Auth0 `sub`.
- [ ] `--env local` mutations work without any login (audit operator = OS username).

## 3 — Org lifecycle against app-dev

- [ ] `org create --name "Smoke Org" --owner-email <your email> --env app-dev --yes` → returns `organizationId` + `stationId`.
- [ ] **Full-provisioning check:** `member switch <orgId> <your email>` (add yourself first if not the owner), refresh the app → you land in "Smoke Org" with the Sandbox connector, "My Station", and working column definitions — indistinguishable from a signup-created org.
- [ ] `org set-tier <orgId> standard --env app-dev --yes` → `previousTier` correct; Settings shows it within ≤60s.
- [ ] `org update <orgId> --name "Smoke Org 2" … --yes` → visible in the app.
- [ ] `member add <orgId> <teammate email>` → they appear in `user list --org`; `member remove` reverses; re-`add` revives (no duplicate row).
- [ ] `member switch <orgId> <your email>` back and forth actually flips which org the app shows you.
- [ ] `org delete <orgId> --env app-dev --yes` → gone from `org list` and from the app; exit 8 on a second delete.

## 4 — seed org + reset against local

- [ ] `seed org --name "QA Sandbox" --member-email <your email> --env local --yes` → `organizationId`, `ownerUserId` (a `seed|…` synthetic), `memberUserId` (you); re-run → `existing: true` (idempotent).
- [ ] `member switch` + app refresh → you're inside "QA Sandbox" with the full provisioning.
- [ ] `org reset <orgId> --env local` → the org's app data is reset via the app's own `db:reset`; the app still functions.

## 5 — Guards (definition-level; no live prod until #83)

- [ ] Unit-covered: prod `org delete`/`org reset`/`seed org` → 6; prod mutation without `--confirm-prod` → 5; staging without `--yes` → 5. Spot-check one live: `org delete <id> --env app-dev` (no `--yes`) → exit **5**, nothing happens.

Sign-off closes the Portal CLIs epic (#191).

---

## Run log

**Local leg (§1, §2, §4) — PASSED** (2026-07-11, against the local compose DB via `--env local`):

- §1: `--help` ok; missing `--env` → exit 2; `org get <missing>` → exit 8; banner on stderr, `--json` payload alone on stdout. ✓
- §2: local mutations ran with **no** device-flow session; audit operator = OS username (`root`). ✓
- §4: `seed org --name "QA Sandbox" --member-email <real user>` created a **fully-provisioned** org (26 column definitions, sandbox connector instance, "My Station", `defaultStationId` set) — indistinguishable from a webhook org; re-run → `existing: true` (idempotent). ✓
- **Current-org hijack fix verified live:** the `--member-email` user's memberships sorted `[real=<ts>, seeded=0]` → current-org selector returned the **real** org; `member switch` flipped it to the seeded org and back. ✓
- member remove → re-add revived the row (1 row, not duplicated); duplicate add → exit 9; `org set-tier` returned `previousTier`; `org reset` spawned `db:reset` ok; `org delete` soft-deleted (double-delete → 8). Audit trail carried ids only. ✓

**App-dev leg (§3) — DEFERRED (environment-blocked, not a code defect).** This container's `aws login` is a custom wrapper (`~/.aws/login/cache/`) whose credentials the AWS JS SDK can't read and can't `export-credentials`; cli-env's (#194) SDK-based secret/param reads therefore can't authenticate here (would affect `portalops` identically). The CLI surfaces it correctly as `ENV_NOT_AUTHORIZED`. Run §3 + the §5 live guard spot-check in an environment where the SDK can resolve AWS credentials.

Local leg signed off 2026-07-11 (automated walkthrough). App-dev leg pending a credential-capable environment.
