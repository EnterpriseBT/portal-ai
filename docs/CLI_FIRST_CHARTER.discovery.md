# CLI-first operations charter — Discovery

**Issue:** [EnterpriseBT/portal-ai#223](https://github.com/EnterpriseBT/portal-ai/issues/223) · epic **CLI-first environment operations** (#222) · blocks #224–#227

**Why this exists.** Today a large share of Portal.ai environment maintenance, log inspection, and configuration still happens by hand in vendor browser consoles (AWS, Stripe, Auth0) and via ad-hoc SQL/scripts. Epic #222 makes the CLI the primary operating surface so the **vast majority of troubleshooting and configuration** — across environments, by a **human or a Claude agent** — is doable from a documented, credentialed, agent-operable CLI. The bar is not literally zero console use: it is that every relevant op has a documented CLI path where one is reasonable, with a small set of **consciously-justified** console-only exceptions (see the coverage bar, Decision 2). Before writing the four per-surface guides (#224 AWS, #225 Stripe, #226 Auth0, #227 native), we need an authoritative map: *what operators/agents actually do* to maintain, inspect, and configure each environment, and *where each op lives today*. Without that map the guides risk documenting the easy paths and leaving a console-only long tail undocumented — the confusing half-state (some surfaces CLI-first, some console-only) the epic exists to eliminate. **This is the foundation charter that inventories every operation, assigns each an owning CLI + agent-operability rating, sets the coverage bar, and records the vendor↔native overlap decisions the other four children are scoped against.**

**Environment framing (corrected).** Three environments, but not three sandboxes:

- **`local`** (`kind: development`) — the inner dev loop (seed → test → reset, many times a day); zero AWS/Auth0, from `.env`. **Functional parity is required: every op that is CLI-operable against `app-dev` must be CLI-operable against `local` too** — `local` is not a degenerate subset. It differs only in being frictionless (no `--yes`, disposable data), never in *which* ops exist.
- **`app-dev`** (app-dev.portalsai.io / api-dev.portalsai.io, `kind: staging`) — **a live, deployed, prod-like QA environment.** This is the real target the epic serves today: it holds real deployed state, and CLI access to it (maintenance, logs, config) is the primary thing this charter must make fully CLI-operable. It runs the **same op set** as `local` (parity), distinguished only by its `staging` guard (every mutation behind `--yes`) and live-data caution.
- **`prod`** (`kind: production`, **future — pending [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)**) — not yet provisioned. Only its *guard behavior* is in scope (destructive ops hard-blocked; non-destructive need `--yes` + `--confirm-prod`); exercising commands against a live prod tenant is explicitly out of scope.

**Where the value is.** The native CLIs (`portalops`, `portalai`) are already agent-operable and largely complete — this epic's highest-value work is the **vendor CLIs**. AWS and Auth0 are where the remaining console time concentrates, so the primary deliverable is that a Claude agent (or human) can perform the common AWS and Auth0 admin/troubleshooting tasks *easily and non-interactively* from the `aws` and `auth0` CLIs. The charter therefore treats the AWS (#224) and Auth0 (#226) surfaces as the priority, and gates each on a concrete **vendor-CLI agent-operability check**: the CLI is installed/available, authenticates per-env without a prompt (or with a single documented human step whose session an agent then reuses), and emits machine-readable output (`--output json`). Stripe (#225) matters but is lighter; native (#227) is documentation + `.claude` wiring only (no code gap).

## The current shape

The "Portal CLIs" epic (#191) already shipped the foundation the charter builds on. Three packages exist and are agent-operable by design.

### The shared env-access layer — `@portalai/cli-env`

| Piece | Location | Note |
|---|---|---|
| Env registry | `packages/cli-env/src/registry.ts:44-58` | `local` (dev, no AWS), `app-dev` (staging, `envName: dev`); `prod` a documented gap (`:57`) |
| Ad-hoc overrides | `registry.ts:80-123` | `~/.portalai/environments.json`, forced `kind: development`; `PORTALAI_HOME` for CI/agents (`:61-63`) |
| AWS-IAM auth path | `packages/cli-env/src/aws.ts:78-122` | ambient creds; ability to read `portalai/${envName}/*` (Secrets Manager) / `/portalai/${envName}/*` (SSM) *is* the per-env authorization |
| Auth0 device-flow path | `packages/cli-env/src/auth0.ts:118-236` | `login` device grant; session cached to `~/.portalai/credentials.json` (0600, atomic); transparent refresh; **user** tokens → actions attribute to the authorizing human |
| Connection seam | `packages/cli-env/src/connection.ts:48-101` | lazy `resolveEnvConnection(env) → { env, kind, apiBaseUrl, db(), token(), dispose() }` |
| Guard | `packages/cli-env/src/guard.ts:31-60` | keyed on `kind`, never env-name strings |
| Audit | `packages/cli-env/src/audit.ts:26-39` | best-effort JSONL to `~/.portalai/audit.log` |

### Native command surfaces — `portalops` & `portalai`

| CLI | Command groups | Location |
|---|---|---|
| `portalops` (`@portalai/devops-cli`) | `vars describe\|list\|get\|set\|apply\|template` (17-key Secrets Manager/SSM catalog `catalog.ts:40-60`); `db tunnel\|psql\|reset\|seed\|reset-seed` | `packages/devops-cli/src/bin.ts:73-224` |
| `portalops tier apply` (#218) | tier-catalog convergence + read-only Stripe price resolution | **shipped (#218/#228)** — `src/commands/tier.ts`, `src/catalog.ts`, wired `src/bin.ts`, tests. Now present on this branch (epic fast-forwarded to `main`) — **not a gap**. (A stale `dist/commands/tier.js` orphan initially misled the survey.) |
| `portalai` (`@portalai/admin-cli`) | `login\|logout`; `org list\|get\|create\|update\|set-tier\|delete\|reset`; `user list\|get`; `member add\|remove\|switch`; `seed org` | `packages/admin-cli/src/bin.ts:67-273` |

Both CLIs share the agent-operability contract: `--json` on every command with a stable `{"error":{code,message}}` envelope; banner on **stderr** so stdout stays pipeable; stable exit-code map; non-interactive confirmations via explicit flags (`--yes`, `--confirm-prod`); cached device-flow sessions with transparent refresh; library-first (each command an importable async fn). Interactive holdouts an agent can't drive: `db psql` REPL and `db tunnel` hold-open (`bin.ts:172-205`) — though `db psql -- <sql>` is a one-shot non-interactive path.

### Per-env guard behavior (already implemented)

`guard.ts:31-60` — `development` → unrestricted; `staging` → any mutation needs `--yes`; `production` → destructive **unconditionally blocked** (`EnvDestructiveBlockedError`), non-destructive needs `--yes` **and** `--confirm-prod`. Admin-cli adds a session requirement (staging/prod mutations require an active device-flow session, `session.ts:34-60`). Devops `db` connect commands add a prod-only `--confirm-prod` barrier just to open a connection (`db.ts:29-38`).

### Vendor surfaces — console/vendor-CLI today

| Surface | What runs today | Where |
|---|---|---|
| **AWS** | deploy (CloudFormation, 7 stacks); migrate/seed (ECS one-off `run-task`); **log inspection (CloudWatch `/ecs/portalai-api-${Environment}`)**; ECS exec (`EnableExecuteCommand: true`); DB tunnel (SSM + bastion) | `infra/cloudformation/`, `.github/workflows/deploy-dev.yml`, `backend.yml:200-207,516` |
| **Stripe** | **runtime landed in `main`** (#215/#176): `apps/api/src/services/stripe.service.ts`, `billing.service.ts`, `routes/billing.router.ts`, `db/schema/stripe-events.table.ts`, `stripe` SDK `^22.3.1`, webhook + billing integration tests. `tier apply` reads prices read-only via `stripe-secret-key`. Price *changes* remain a Stripe-side act (vendor CLI). Now present on this branch (epic fast-forwarded) | `apps/api/src/services/stripe.service.ts`, `billing.service.ts`, `routes/billing.router.ts` |
| **Auth0** | JWT middleware; webhook user-sync; device-flow login. **Directory ops (user/app/tenant/role/log inspection) not CLI-covered** — deferred at `PORTAL_ADMIN_CLI.discovery.md:109` | `apps/api/src/middleware/auth.middleware.ts`, `packages/cli-env/src/auth0.ts` |
| **Secrets** | Secrets Manager `portalai/${env}/*`, SSM `/portalai/${env}/*`, local `.env`. `stripe-secret-key` **is** in the `portalops vars` catalog (`catalog.ts:50`, #218) but **not yet provisioned in the CloudFormation backend stack** (`backend.yml` has no Stripe secret) — live `app-dev` can't resolve it until deploy-side provisioning lands ⚠️ | `backend.yml:44-70,472-504`, `catalog.ts:50` |

## The design space

### Decision 1 — Charter structure / operation taxonomy

How to organize the inventory so a reader can answer "how do I do X via CLI" for any op.

| | A — by owning CLI | B — by category×env | C — one op table, tagged |
|---|---|---|---|
| Shape | sections per aws/stripe/auth0/portalops/portalai | matrix maintenance/logging/config × local/app-dev/prod | flat table: op, category, envs, owning CLI, operable?, guide ref, disposition |
| "How do I X" lookup | good if you know the tool | poor (op split across cells) | **best — one row per op, searchable** |
| Feeds #224–#227 scoping | grouped by guide already | needs re-grouping | filter by owning CLI → one guide's ops |

**Lean: C — a single operations table, but as a *thin index*, not a fat runbook.** The charter is the coverage/scoping layer; the runbook depth lives in the four per-surface guides. One row per operation, columns `[operation · category (maint/log/config) · envs · owning CLI · operable? (y/n) · guide ref · disposition]`. The `guide ref` points at the section of #224–#227 that documents the op in full (exact command, flags, examples) — so "how do I do X" is answered by *charter row → guide section*, and the charter never duplicates command detail it would then have to keep in sync. Each guide is still `filter(owning CLI)` over this table.

Operations are phrased as the **tasks an operator actually asks for** ("tail prod API logs for error X", "update a subscription price", "add a subscription tier"), not abstract capabilities — the agent's entry point is a task, so the table's left column must speak in tasks. The **one piece of substance the charter owns** (rather than delegating to a guide) is a **common-workflows** section for tasks that span CLIs — those belong to no single guide. The canonical example: *add a subscription tier* = (1) create the Stripe price + lookup key (Stripe, vendor — no amounts in code, lookup keys only), (2) add the `TIER_CATALOG` entry referencing that lookup key (core), (3) `portalops tier apply --env <env>` to converge the DB. The agent needs that recipe end-to-end; each step's detail still lives in its surface guide.

### Decision 2 — The coverage bar

The issue requires a **concrete, measurable threshold** and current coverage reported against it.

| | A — flat % operable | B — zero-unclassified + tiered target | C — frequency-weighted |
|---|---|---|---|
| Definition | ≥X% of ops have a CLI path | every op is CLI-operable **or** a justified exception (no unclassified gap), **and** maintenance+config ≥ target% operable | weight by op frequency |
| Measurable | yes | yes | needs frequency data we don't have |
| Matches epic goal | partial | **directly — the goal is "no console-only long tail," i.e. no unclassified gap** | overkill |

**Lean: B.** Define **CLI-operable** as a 3-part predicate: *(i)* a documented command exists (native **or** vendor-CLI), *(ii)* it is non-interactive or flag-guarded (no interactive-only path), *(iii)* it emits machine-readable output or the guide documents how to parse it. The bar: **100% of inventoried ops classified** (every op is operable or a recorded justified console-only exception — zero unclassified gaps), **and ≥90% of maintenance + configuration ops CLI-operable across both live-accessible environments — `local` and `app-dev` — with functional parity** (an op operable in one must be operable in the other; the difference is guard strictness, not feature set). Logging is judged the same way but reported separately (CloudWatch/Auth0 log tailing is vendor-CLI-operable, not native). Current coverage is measured and reported in the charter itself.

### Decision 3 — Agent-operability rating

The issue's deliverable names the axes: "non-interactive? `--json`? guarded?".

**Lean: a binary `operable` / `not operable` rating** — no graded tier. An op is **operable** iff it satisfies the D2 CLI-operable predicate in full: a command exists, it is non-interactive (or flag-guarded, never interactive-only), and it emits machine-readable output (or the guide documents how to parse it). The three axes the issue names are the *conditions* of "operable," not a surfaced score. Anything that fails any condition is **not operable** — a gap that gets a disposition (Decision 5). Where an op is operable only via a documented workaround (e.g. `db psql -- <sql>` instead of the REPL, `aws logs ... --output json`), it counts as operable and the exact command captures the how; the row's `disposition` column notes the workaround. This keeps the table scannable — one column, one bit — while the `exact command` column carries the nuance.

### Decision 4 — Vendor↔native overlap policy

The epic rejects wrapping vendor CLIs behind `portalops`; the charter decides where genuine overlap is nonetheless justified.

**Lean: the test is "does the native command compose vendor primitives into a Portal-domain operation, or is it a thin passthrough?"** Passthroughs are rejected (use the vendor CLI, documented in #224–#226). The **already-shipped** native-over-vendor glue passes the test and is recorded as justified precedent, not new overlap: `vars` (Secrets Manager/SSM → a curated 17-key env-config catalog with validate-then-write), `db tunnel/psql` (SSM+bastion → a `resolveEnvConnection`-backed DB session), `tier apply` (Stripe `prices.list` read → tier-catalog convergence in one DB transaction). Each turns raw vendor calls into a Portal domain op. Any *new* overlap a guide proposes must clear the same bar in the charter, or it's a vendor-CLI runbook entry.

### Decision 5 — Gap disposition routing

Every gap gets a disposition: native gap-fill (#227) **or** a justified vendor-CLI/console exception.

**Lean: route by ownership.** Vendor-native ops (CloudWatch log tailing, ECS exec/run-task ad-hoc, Auth0 directory + log inspection, Stripe event/subscription inspection) → **documented vendor-CLI runbook** in #224/#225/#226 (they're the vendor's domain; wrapping them is explicitly rejected). Native gap-fill (#227) is reserved for **Portal-domain** ops missing a `portalops`/`portalai` command — and this survey surfaced **none**: the native inventory is complete, `tier apply` shipped (#218/#228), and the one candidate (an audit-log query command over `~/.portalai/audit.log`) is **declined** — the log stays write-only, and AWS-side operation auditing is covered by **CloudTrail** (documented in #224). **#227 therefore reduces to documentation + `.claude` wiring** (COMMANDS/README refresh, CLAUDE.md), not gap-fill code. With Stripe billing landed in `main` (#215), Stripe event/subscription inspection is backed by `stripe_events` + the `stripe` SDK rather than blocked on #176 — the charter re-checks whether any inspection op still lacks a CLI path instead of deferring it.

## Tradeoff comparison

| | D1 op-table | D2 zero-unclassified+90% | D3 binary operable | D4 compose-test | D5 route-by-owner |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| New code | No (doc) | No | No | No | Feeds #227 gap list |
| Blocks on #83/#176 | No | app-dev measured now; prod documented | No | No | Stripe inspect → #176 exception |

## Recommendation

1. **Charter = a thin index + coverage layer** (Decision 1 C): a row per op with `operation (task-phrased) · category · envs · owning CLI · operable? · guide ref · disposition`; runbook depth lives in the four per-surface guides, and the charter owns only the cross-surface **common-workflows** recipes. Each guide is `filter(owning CLI)` over the table.
2. **Coverage bar** (Decision 2 B): *CLI-operable* = command exists + non-interactive/flag-guarded + machine-readable-or-documented-parse; bar = **100% of ops classified with a disposition + ≥90% of maintenance/config ops CLI-operable across `local` and `app-dev` with functional parity** (same op set both envs; guard strictness differs, feature set does not); logging reported separately; current coverage measured in the doc.
3. **Rating** (Decision 3): a **binary `operable` / `not operable`** per row — operable iff a command exists + non-interactive/flag-guarded + machine-readable-or-documented-parse; the `exact command` column carries any workaround nuance.
4. **Overlap policy** (Decision 4): no vendor wrapping; native-over-vendor allowed only when it composes into a Portal-domain op; the three shipped cases (`vars`, `db`, `tier apply`) are the recorded precedent.
5. **Gap routing** (Decision 5): vendor-native gaps → vendor-CLI runbook (#224–#226); **no Portal-domain code gaps surfaced** (native inventory complete; `tier apply` shipped; audit-log reader declined — CloudTrail covers AWS audit), so **#227 is docs + `.claude` wiring, not gap-fill code**. Stripe inspection is backed by the landed billing runtime (#215), re-checked rather than deferred.
6. **No actor tagging; task-oriented for the agent, assumed unattended.** Ops are phrased as operator tasks (the three examples above), not capabilities. Auth is already configured per-env and the human drives the session, so every op is assumed **unattended-operable** — no self-serve/operator/agent split. Guard flags a task needs (`--yes`, `--confirm-prod`) are baked into that row's `exact command` so the agent copies a runnable invocation, not a caveat to interpret. The human reads the README; the charter serves the agent.
7. **Environment scope**: `local` and `app-dev` both run the full op set (functional parity); `app-dev` is the live prod-like QA target the bar is measured against for live-data caution; `prod` guard behavior documented but never exercised (#83).

## Open questions

1. **~~One doc or split by surface?~~ — RESOLVED: thin charter + rich per-surface guides.** `docs/CLI_OPERATIONS_CHARTER.md` is a thin index (the operations table + coverage number + cross-surface common-workflows); the runbook depth (exact commands, flags, examples, auth setup, allowlists) lives in the four guides #224–#227. The charter's `guide ref` column points into them; they never duplicate the index.
2. **Is CloudWatch log tailing "operable" via the AWS CLI, or a gap?** `aws logs tail /ecs/portalai-api-dev --format short --follow` exists and is non-interactive + `--output json`-capable. **Lean: operable (vendor CLI), documented in #224; not a native gap.**
3. **~~The epic branch is behind `main`~~ — RESOLVED.** The epic branch was 10 commits behind `main` (missing #218 tier apply, #219 tier entitlements, #215 Stripe billing), which is why the initial survey mis-read `tier apply` and Stripe as absent. `epic/cli-first-ops` has been fast-forwarded to `main` and pushed, and `feat/cli-first-charter` rebased onto it — the charter is now enumerated against the real shipped surface. (A stale `dist/commands/tier.js` orphan remains in the working tree; a clean `npm run build` clears it — cosmetic, not a gap.)
4. **`stripe-secret-key` provisioning — KEPT as a finding; it splits cleanly along the overlap line.** The key must (a) be **set** in `app-dev`'s Secrets Manager — `portalops vars set STRIPE_SECRET_KEY --env app-dev --yes`, already operable and exactly what `portalops vars` exists for — and (b) be **injected into the ECS task** at deploy via a `ValueFrom` mapping in `backend.yml`, which is IaC/CI, not a `portalops` op. So the config half is CLI-operable today; the deploy-wiring half is the real gap. **Disposition: the Stripe guide (#225) documents the `vars set` step; the `backend.yml` injection routes to deploy-infra. A clean illustration of the ownership line — `portalops` owns config-value CRUD, deploy/IaC owns task wiring.**
5. **What "current coverage" number do we commit to?** We can only measure once the table is enumerated. **Lean: compute it as `(operable ops / total ops)` from the finished table and report the raw fraction + the maintenance/config sub-figure against the ≥90% bar — no target-fudging.**

## Enterprise-scale considerations

The deliverable is a **documentation artifact** (a charter), so the runtime dimensions apply to the *operating contract it defines*, not to the doc itself:

- **Multi-tenancy / isolation** — *engaged (as a charter invariant).* Per-env isolation is the whole safety story: AWS-IAM scopes which env's `portalai/${env}/*` an operator reads; Auth0 per-env apps keep tokens env-scoped; `app-dev` creds must never reach `prod`. The charter records each op's env-applicability so isolation is auditable per row.
- **Accuracy & auditability** — *engaged.* Every mutating CLI op writes `~/.portalai/audit.log` (best-effort, local) with operator identity + env; device-flow user tokens mean agent-driven actions attribute to the authorizing human. The local log stays **write-only by decision** — a queryable reader is out of scope; **AWS-side operation auditing is covered by CloudTrail** (documented in #224). Centralized/server-side audit remains a separate concern (#179), not this epic's.
- **Failure modes** — *fail-closed, verified per row.* No implicit prod default; active env echoed every command; destructive prod ops hard-blocked; missing creds fail closed. Guard flags each task needs (`--yes`, `--confirm-prod`) are baked into that row's exact command (Recommendation 6), so fail-closed behavior is visible per row, not re-implemented.
- **Contract stability** — *engaged.* The charter *is* the operating contract #224–#227 bind to; the op-table shape must stay additive-open so future paid/enterprise ops (new tiers, RBAC roles, `prod` on #83) are new rows, not a re-plumb.
- **Concurrency & correctness** — *N/A for the doc*; the underlying seam already handles concurrent-invocation token refresh (atomic write) — charter notes it, doesn't re-solve it.
- **Scale & unbounded growth** — *Lean:* the inventory grows O(ops); a new environment or surface is new rows + a preamble, no structural change.
- **Data lifecycle** — *engaged (lightly).* `app-dev` holds real QA data; the charter must mark which ops touch persistent state (reset/seed/vars apply) vs. read-only, so the guides carry the right caution for a live env.

## What this doesn't decide

- **The per-surface runbooks themselves** — #224 (AWS), #225 (Stripe), #226 (Auth0), #227 (native). The charter scopes them; it doesn't write them.
- **Implementing any command** — the charter classifies and routes; it writes no code. This survey surfaced **no native code gap** (inventory complete, `tier apply` shipped, audit-log reader declined), so #227 is docs + `.claude` wiring. Any Auth0/Stripe *vendor-CLI* coverage lives in the guides (#224–#226), not here.
- **Live `prod` execution** — pending #83. Prod guard behavior is documented; no command is exercised against a prod tenant.
- **The Stripe/Auth0 server-side runtime** — #176 webhook/billing and the JWT middleware are out of scope; this epic is operator/agent CLI use, not the API's runtime paths.

## Next step

Write `docs/CLI_FIRST_CHARTER.spec.md` (the charter's contract: the operations-table column schema, the CLI-operable predicate + coverage-bar formula, the binary operable rating, the overlap compose-test, the gap-disposition routing rules, the inline per-env guard-flag convention, and the common-workflows recipe format — i.e. everything a reader/agent needs to *produce and audit* the charter) and `docs/CLI_FIRST_CHARTER.plan.md`. The plan will likely slice as: (1) enumerate the task-phrased operations index per surface (AWS/Stripe/Auth0/native), prioritizing AWS + Auth0, with `operable?` + `guide ref` + `disposition` per row; (2) compute current coverage against the bar; (3) write the overlap decisions, gap list with dispositions, and the cross-surface common-workflows recipes (starting with "add a subscription tier"); (4) cross-link the four child guides and reconcile the flagged findings into the gap list. Runbook depth is explicitly *not* in this deliverable — it lands in #224–#227. The charter deliverable is a **new** `docs/CLI_OPERATIONS_CHARTER.md` (distinct from this discovery doc), since #224–#227 reference it as a standing operating contract, not a one-time design note.
