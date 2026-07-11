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

Signed off on ____________ by ____________.
