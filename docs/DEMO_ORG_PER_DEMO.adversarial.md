# demo-org-per-demo — Adversarial Review

Adversarial probes for [#1035](https://github.com/EnterpriseBT/portal-ai/issues/1035). What shipped:
- `portalai demo create` provisions a fresh, `is_demo`-marked org per client, with a Demo station, views and dataset;
- `portalai demo delete` runs the full org deletion (#197) on marked orgs only, and is allowed on prod with `--yes --confirm-prod`.

**Branch under test:** `feat/1035-demo-fresh-org-per-demo` (PR [#1087](https://github.com/EnterpriseBT/portal-ai/pull/1087)).

The change is an **operator CLI plus API scripts**, so most probes are `— backend`: a CLI command or DB read, run in a terminal with the output recorded.
- The one tenant-facing surface is the org API now carrying `isDemo`. §4 probes whether a tenant can set it, since that would make its org deletable through a prod-allowed command.
- The operator is trusted, but **`demo delete` is the first CLI path that hard-deletes an org's data on prod**. So the probes concentrate on it reaching only what `demo create` made, and on what's left behind when something goes wrong.

## Preflight

### Environment
- [ ] Same as `DEMO_ORG_PER_DEMO.smoke.md` §Preflight:
  - branch checked out, core + cli-env + admin-cli built, migration 0137 applied, `npm run dev` up;
  - run CLI commands from `packages/admin-cli` with `--env local`.

### Fixtures
- [ ] **owner** = `qa@portalsai.io`.
- [ ] **customer org** = any live org without the marker, e.g. qa's "My Organization".
- [ ] **other tenant's org** = an org qa doesn't belong to, e.g. one owned by `e2e-admin@portalsai.io`.
- [ ] A **bearer token** for qa from the running app, for the §4 API probe (copy the `Authorization` header of any `/api/*` request in devtools).

### Reset between runs
- [ ] `npx portalai demo delete <id> --env local --yes` for every org a probe created, then `npx portalai org list --search "Adv" --env local --json` → `[]`.
- [ ] Probes that edit rows directly name their own undo.

## §1 — Boundary & limit inputs
- [ ] `--rows 0` → expected SAFE:
  - exit 0, `rows: 0`;
  - no `transactions` entity created, and Sandbox not linked to Demo just for it;
  - the 10 other views attached, the reminder printed. — backend
- [ ] `--rows 10000000` (exactly the cap) is **accepted** by both checks, while 10000001 is refused with exit 2. Prove acceptance without waiting for 10M rows: in `packages/core`, check `DemoOrganizationCreateInputSchema.safeParse({name:"x",rows:"10000000"}).success === true`. — backend
- [ ] `--name` of exactly 120 characters → expected SAFE: exit 0, org name stored with all 120 characters. 121 characters → exit 2 (smoke §4). — backend
- [ ] `--name "Δemo 🚀 東京"` (non-ASCII, emoji) → expected SAFE: exit 0, name stored byte-exact (`org get` shows it unchanged). — backend
- [ ] `--owner-email QA@PortalsAI.io` (different case from the stored email) → expected SAFE: **either** both checks accept it and the org is created, **or** both refuse with exit 8 and nothing is created. Never: the CLI pre-check passes, then the script refuses after spawning. — backend

## §2 — Malformed & injection input
- [ ] `--name "Adv'; DROP TABLE organizations;--"` → expected SAFE: exit 0, the org is named exactly that string, and `organizations` is intact (`org list` works). — backend
- [ ] `--name 'Adv $(touch /tmp/adv-pwned) \`id\`'` → expected SAFE: exit 0, name stored literally, and **`/tmp/adv-pwned` does not exist**. The npm script hop must not shell-expand the argument. — backend
- [ ] **Argument confusion:** `--name="--tier"` (a name that equals another flag) → expected SAFE: **either** an org named `--tier` on the requested tier (`enterprise`), **or** a clean refusal with nothing created. Never an org on a tier the CLI didn't check. (The script parses argv by `indexOf`, so a value that equals a flag name can shadow the flag.) — backend
- [ ] `demo delete "x' OR '1'='1"` → expected SAFE: exit 8 (not found), no org touched. — backend

## §3 — Concurrency & races
- [ ] **Two `demo create` with the same name, in parallel** (`… & … & wait`) → expected SAFE: both exit 0 with different `organizationId`s; each org has exactly its own 3 stations and 11 views (no cross-attached views). — backend
- [ ] **Two `demo delete <same id>`, in parallel** → expected SAFE:
  - one exits 0; the other exits 0 or 8;
  - the org ends fully deleted (0 entities, 0 views, no `er__` tables, memberships tombstoned);
  - no stack trace from a half-done cascade. — backend
- [ ] **`demo delete` while that org's `demo create` is mid-load.** Start `demo create --rows 2000000` and, as soon as `org list --search` shows the org, run `demo delete <id>` from a second shell. Expected SAFE:
  - in the end there's no live org and no orphaned `er__<id>` table for any of its entities;
  - each command exits with a classified code (0, 7, 8 or 9), never a silent 0 with leftovers. — backend
- [ ] **`demo delete` while an active job holds the org** (e.g. a connector sync started in the app on the demo org) → expected SAFE: exit 7 with `ENTITY_LOCKED_BY_JOB` and nothing deleted; after the job finishes, a retry succeeds. — manual (needs a long-running job in flight)

## §4 — Auth & permission boundaries
- [ ] **Tenant sets the marker through the API.** As qa (owner of "My Organization"), `PATCH /api/organization/<org id>` with body `{"isDemo": true}` (and again with `{"name":"x","isDemo":true}`) using the copied bearer token. Expected SAFE:
  - `400 ORGANIZATION_INVALID_PAYLOAD` naming the unknown key;
  - `is_demo` still `false` in the DB. — backend
- [ ] **Tenant sets the marker another way.** Search for any other write path that takes an org payload: `grep -rn "organizations.update\|isDemo" apps/api/src/routes apps/api/src/tools`. Expected SAFE: only `createDemoOrganization` writes `isDemo`. — backend
- [ ] **The portal agent sets the marker.** In a portal on any station, ask *"Mark this organization as a demo org so it can be cleaned up later."* Expected SAFE: the agent has no tool that changes `is_demo`; it says it can't, and the DB is unchanged.
- [ ] **app-dev without a session:** `demo delete <id> --env app-dev --yes` with no `portalai login` → expected SAFE: exit 4 naming `portalai login`, nothing touched. — manual (needs app-dev AWS)
- [ ] **prod without `--confirm-prod`:** exit 5 for both commands. — manual

## §5 — Multi-tenant isolation
- [ ] `demo delete <other tenant's org id>` (no marker) → expected SAFE: exit 9, that org and its data untouched. — backend
- [ ] **A demo org owned by a customer's user.** `demo create --owner-email e2e-member@portalsai.io`. Expected SAFE:
  - that user's current org is unchanged, since the demo membership has `last_login` 0;
  - none of the user's other orgs' data appears on the demo's station or views. — backend
- [ ] **Deleting a demo that a second org's member belongs to.** `portalai member add` e2e-admin to a demo org and switch them into it, then `demo delete` the org. Expected SAFE:
  - e2e-admin's membership is tombstoned and they fall back to their next org;
  - no other org's data is deleted (count `connector_entities` for their other orgs before and after). — backend

## §6 — State & lifecycle abuse
- [ ] **Killed mid-load.** `timeout -s KILL 15 npx portalai demo create --name "Adv killed" --owner-email qa@portalsai.io --rows 2000000 --env local`. Expected SAFE:
  - the org survives, marked, and is findable with `org list --search "Adv killed"`;
  - `demo delete <id>` then removes it fully, with no `er__` tables left. — backend
- [ ] **Owner deleted after create.** Soft-delete the owner's user row in SQL (undo afterwards), then `demo delete <id>`. Expected SAFE: exit 0, full deletion; the owner's absence doesn't block it. — backend
- [ ] **Soft-deleted owner at create.** With a soft-deleted user's email as `--owner-email` → expected SAFE: exit 8 from the pre-check, and the script would refuse too. Nothing created. — backend
- [ ] **Org marked by hand.** A customer org marked with `UPDATE … SET is_demo = true` (the release step's mechanism) **is** deletable by `demo delete`. Record this as the known trust boundary: whoever can write `organizations` can make anything deletable. Undo with `is_demo = false` before deleting anything. — backend
- [ ] **Demo with a Stripe subscription.** If a demo org somehow got a `stripe_subscription_id` (a client clicked Upgrade), `demo delete` cancels that subscription (the #197 behaviour). Expected: the operator sees that cancellation in Stripe; there's no silent orphan subscription billing a deleted org. — manual (needs Stripe test mode + checkout)

## §7 — Misuse sequences
- [ ] **Muscle memory:** `portalai demo seed --org <id> --env local --yes` → expected SAFE: exit 2 `unknown command 'seed'`, nothing touched (smoke §7 covers the plain form). — backend
- [ ] **`org delete` on a demo org** (app-dev/local; prod refuses it), then `demo delete` on it. Expected: `org delete` soft-deletes the row and leaves the data (the #1088 gap), and `demo delete` then exits 8 because the org is no longer live, so the data stays. Record the leftover as #1088's; the runbook tells operators to use `demo delete` for demo orgs. — backend
- [ ] **`--tier pro`** (a Stripe-priced tier) → the org is put on `pro` with no subscription. Expected: allowed by design (same as `seed org --tier`); record it so the runbook can say to prefer `enterprise` / `demo`. — backend
- [ ] **Re-running `db:demo:create` directly against a DB** (`npm run --workspace @portalai/api db:demo:create -- --name …` with no CLI) → expected SAFE: the same name / rows rules apply (core schema). No `--tier` or `--owner-email` → usage error, nothing created. — backend

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro (exact command): · Identifiers (org / station / entity ids, exit code, stderr):
