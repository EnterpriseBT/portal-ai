# Production vendor tenants & config provisioning — Discovery

**Issue:** [EnterpriseBT/portal-ai#384](https://github.com/EnterpriseBT/portal-ai/issues/384) · child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)

**Why this exists.** The prod AWS stacks boot only if every managed config key resolves: `backend.yml` takes twelve secrets by ARN parameter and reads eight SSM parameters by convention path, out of a 24-key catalog. Today `portalai/prod/*` and `/portalai/prod/*` are empty, and the upstream accounts those values come from — a production Auth0 tenant, Google and Microsoft Entra OAuth clients, and prod-only Anthropic / Tavily / Mapbox keys — do not exist. This is the ticket that creates the vendor identities and populates the catalog, and it is the hard prerequisite for every other child of the epic.

It is also the epic's most **unusual** child: most of the work happens in vendor consoles, not in this repo. The engineering question is therefore not "what code implements this" but "what does the repo need so that a production environment can be provisioned *safely* — guarded, audited, and without a production credential passing through a human's clipboard". Three things surfaced during the survey that change the plan.

## The current shape

### The environment registry and its guards

| Piece | Location | Note |
|---|---|---|
| Built-in environments | `packages/cli-env/src/registry.ts:44-58` | `local` + `app-dev` only; a comment names #83 as where `prod` lands |
| Ad-hoc overrides | `registry.ts:80-122` | merged from `~/.portalai/environments.json` |
| Guard | `packages/cli-env/src/guard.ts:32-60` | keyed on `kind`, never on the env name |
| Path prefixes | `registry.ts:152-158` | `portalai/<envName>/…` (secrets), `/portalai/<envName>/…` (SSM) |

Two properties of the override path matter enormously here. An override **may not shadow a built-in** (`registry.ts:109-113`, throws), and its `kind` is **forced to `"development"`** (`registry.ts:118`, with the comment "ad-hoc targets are never staging/prod").

### The config catalog and its write path

| Piece | Location | Note |
|---|---|---|
| Catalog | `packages/devops-cli/src/catalog.ts` | **24 keys** — 12 secrets + 12 SSM once #382 adds the Mapbox entry |
| `vars set` | `commands/vars.ts:170-196` | one key; **`"-"` reads stdin**; refuses empty; guarded; audited |
| `vars apply` | `commands/vars.ts:243-268` | batch from a `KEY=VALUE` file; validates wholesale before any write |
| `vars template` | `commands/vars.ts:277-295` | writes a **plaintext** file (0600) of every catalog value |
| Site-rebuild hook | `vars.ts:186-189` | a `siteConfig` key write fires `repository_dispatch` |

`applyVars` → `parseEnvFile` **rejects an empty value** (`vars.ts:229-231`). So `vars template` on a fresh environment emits `KEY=` for all 22 keys, and that file cannot be applied until every line is either filled or deleted.

### What consumes each key

| Consumer | Reads | Via |
|---|---|---|
| ECS task | 12 secrets by ARN, 6 SSM by path | `backend.yml:244-320` — secrets scoped by explicit ARN, SSM by `/portalai/${Environment}/*` |
| Web + site builds | `SUPPORT_EMAIL`, `SALES_EMAIL`, `ADMIN_EMAIL` | resolved from SSM at build time (`deploy-dev.yml:196-215`) |
| `portalai login` | `AUTH0_CLI_CLIENT_ID` | device flow (#194) — never reaches the container |
| `portalops db *` | `database-url` secret | `cli-env/src/connection.ts:27`, `aws.ts:126` |

### The database credential

`database.yml:73` sets `ManageMasterUserPassword: true`, so RDS mints its own `rds!db-…` secret holding the master password, and the stack exports only the endpoint (`:85-98`). Nothing composes these into a connection string — `cli-env` **reads the `database-url` secret** and rewrites its host through the SSM tunnel (`connection.ts:78-89`). The secret is therefore hand-assembled from four parts: the master username (a stack parameter), the RDS-managed password, the exported endpoint, and the database name. Dev's was created out-of-band; the workflow only ever receives its ARN.

## The design space

### Decision 1 — where the `prod` registry entry lands

The epic currently assigns the one-line `BUILTIN_ENVIRONMENTS` addition to #387 (CLI activation), sequenced **last**. But every provisioning command in this ticket is `portalops … --env prod`, and `getEnvironment("prod")` throws `ENV_NOT_CONFIGURED` until that entry exists.

| | A — leave it in #387 | B — move it into #384 | C — operator adds a local override |
|---|---|---|---|
| Can prod be provisioned? | No — every command throws | Yes | Yes |
| Guards that apply | n/a | `production`: destructive blocked, mutations need `--yes --confirm-prod` | **`development` — none** |
| Epic ordering | Inverted: the last child blocks the first | Consistent | Consistent |

**Lean: B — move the registry entry into this ticket.** A is simply impossible, and C is worse than impossible: overrides force `kind: "development"` (`registry.ts:118`), so provisioning production through one would run every write with **development guards** — no `--yes`, no `--confirm-prod`, and destructive operations permitted. The override path was designed for throwaway test targets and it correctly refuses to shadow a built-in, which means there is no safe way to reach prod except in code. #387 keeps guard *verification* and the documentation sweep, which is the part that can only be honest at the end.

### Decision 2 — how prod secret values are written

| | A — `vars template` → edit → `vars apply` | B — per-key `vars set KEY -` from stdin |
|---|---|---|
| Where the value lives | a plaintext 0600 file on the operator's disk | process stdin only |
| In `ps` output / argv | no | no (that is what `-` is for) |
| In shell history | no | no |
| Fresh-env ergonomics | template emits 22 empty lines; unfilled ones must be **deleted** or apply throws | one command per key, resumable |
| Re-run on a populated env | **dumps every production secret to disk** | unaffected |

**Lean: B, and say so in the runbook.** `vars template` is a genuine convenience for a non-prod environment, and a liability for a production one — its re-run behavior is to write every live production secret to a file. `setVar`'s `"-"` stdin path (`vars.ts:177`) already exists precisely so a value need not appear in argv, and per-key writes are naturally resumable across the several days this ticket will span while vendor accounts get approved. The cost is 22 commands instead of one; for a once-per-environment act with this blast radius, that is the right trade.

### Decision 3 — composing `DATABASE_URL`

The one credential nobody can eyeball for correctness, assembled by hand from an RDS-managed password.

| | A — document the composition | B — `portalops db url --env <env> [--write]` |
|---|---|---|
| Where the prod DB password goes | console → clipboard → terminal → secret | AWS API → AWS API; never rendered |
| Failure mode | a typo deploys fine and the ECS task crash-loops on connect | none of that class |
| New surface | none | one subcommand, plus `rds:DescribeDBInstances` on the operator role |
| Reuse | once per environment | once per environment, forever |

**Lean: B.** The argument is not convenience — it is that hand-composition puts a production database password through a human clipboard and a shell, and the standing rule is that safety gets enforcement rather than instructions. The pieces already exist: `cli-env` resolves secrets and the stack exports the endpoint; the command reads the `rds!…` managed secret, composes, and optionally writes `database-url` in one guarded, audited step. `--write` is a mutation and inherits the `--yes --confirm-prod` barrier for free.

### Decision 4 — capturing twelve secret ARNs into GitHub

Every prod secret is newly created, so `writeEntry` returns `created: true` for all twelve and each ARN must become a `PROD_SECRET_ARN_*` repository secret before #383's backend stack can deploy.

| | A — copy each ARN by hand | B — `vars arns --env <env>` emitting ready-to-run `gh secret set` lines |
|---|---|---|
| Effort | 12 console lookups | one command |
| Failure mode | a mispasted ARN fails at deploy with an opaque ECS error | none |
| Scope | none | small — the ARNs are already in hand after each write |

**Decided: A — dropped from scope (2026-08-14).** ARNs are not secret, so the only argument for B was saving twelve copies, and a provisioning convenience used once per environment does not earn a permanent CLI surface. The runbook carries the `aws secretsmanager describe-secret --secret-id portalai/prod/<name> --query ARN` one-liner and the `gh secret set` line it feeds, which is where a once-per-env step belongs. The mispaste risk is real but bounded: a wrong ARN fails at deploy, loudly, before any traffic.

### Decision 5 — Google and Microsoft OAuth clients: shared or per-env

| | A — one client carrying both dev and prod redirect URIs | B — separate clients per environment |
|---|---|---|
| Blast radius of a leaked secret | both environments | one |
| Consent-screen verification | done once | Google verification needed for the prod client specifically |
| Matches existing practice | no — Auth0 and Stripe are already per-env | yes |

**Lean: B.** Every other vendor in this system is already per-environment (separate Auth0 tenants, separate Stripe accounts), and the catalog is per-env by construction. A shared client would be the only cross-environment credential in the product, which is exactly the property that makes a dev compromise a production one.

## Tradeoff comparison

| | Registry entry here (D1-B) | stdin writes (D2-B) | `db url` (D3-B) | ~~`vars arns`~~ (D4 — dropped) | Per-env clients (D5-B) |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | No — runbook only | Yes |
| Repo code change | 1 line + tests | none | one subcommand | none | none |
| Blocks another child | unblocks all | no | no | no | no |

## Recommendation

1. **The `prod` entry lands in `BUILTIN_ENVIRONMENTS` in this ticket**, not #387: `{ name: "prod", kind: "production", apiBaseUrl: "https://api.portalsai.io", aws: { region: "us-east-1", envName: "prod" } }`. #387 retains live guard verification and the doc sweep.
2. **Prod values are written per-key with `portalops vars set KEY - --env prod --yes --confirm-prod`**, reading each value from stdin. `vars template` / `vars apply` are documented as non-prod tooling, with the reason.
3. **Add `portalops db url --env <env> [--write]`**, composing the connection string from the RDS-managed master secret and the stack's endpoint export, so the production database password is never rendered to a human.
4. **Separate Google and Microsoft OAuth clients for prod**, mirroring the per-env separation Auth0 and Stripe already have.
5. **All three metered vendor keys get prod-only credentials with account-level caps** — Anthropic on its own workspace limit, Tavily on its own plan, and Mapbox scoped to the geocoding APIs with a spend limit, since `bulk_geocode_records` can fan out across a whole column.
6. **Capturing the twelve secret ARNs into GitHub stays a runbook step**, not a CLI feature (Decision 4).
7. **The deliverable doc is a provisioning runbook** (`docs/PROD_PROVISIONING.runbook.md`), ordered so each step's prerequisites are already satisfied, and written to be re-runnable for any future environment rather than as a one-off prod checklist.

## Open questions

1. **Does the operator IAM identity already reach `portalai/prod/*` and `/portalai/prod/*`?** The task role self-scopes per environment via the stack (`backend.yml:244-266`), but the human/CLI role is not defined in this repo. **Lean: verify first, and treat a gap as part of this ticket** — every later step depends on it, and discovering it mid-provisioning is the worst time.
2. **What are prod's `NAMESPACE` and `SYSTEM_ID`?** `NAMESPACE` seeds uuidv5 generation and dev uses `portalsai-staging`. **Lean: `portalsai-prod` and a fresh `SYSTEM_ID`** — they must differ from dev so a deterministic id can never collide across environments, and they are effectively immutable once data exists.
3. **Is `qa@portalsai.io` reachable before the three prod addresses are?** The prod values are the real inboxes and are the first environment where they diverge from `qa@`. **Lean: confirm delivery on all three *before* writing the SSM values**, since a wrong address here is published on the public site rather than failing loudly.
4. **Does `GITHUB_DISPATCH_TOKEN` get proven in dev first?** `DEV_SECRET_ARN_GITHUB_DISPATCH_TOKEN` does not exist as a repo secret, so the dispatch loop has never run anywhere. **Lean: yes — provision dev's token as part of this ticket.** Production must not be the first place an untested code path executes, and it costs one token to remove that risk.
5. **Should `AUTH0_WEBHOOK_SECRET`, `ENCRYPTION_KEY` and `OAUTH_STATE_SECRET` be generated by the CLI?** **Lean: no.** `openssl rand -base64 32` in the runbook is sufficient, the values are write-once, and a generator that stores what it generates is a worse hazard than the manual step it replaces.

## Enterprise-scale considerations

- **Concurrency & correctness.** `vars set` is a single conditional write per key with no read-modify-write, so concurrent operators cannot interleave a partial value. **Lean: no change needed**; the per-key model is already atomic where a batch file would not be.
- **Accuracy & auditability.** Every mutating `portalops` call appends to `~/.portalai/audit.log` with key and kind but never the value (`vars.ts:180-185`). For a production bootstrap that record matters more than usual — it is the only evidence of who provisioned what. **Lean: keep per-key writes partly *because* they produce a per-key audit trail**, where a single `vars apply` collapses 22 acts into one line each but with a shared timestamp and file basename. Centralized audit remains #179.
- **Failure modes.** A missing key fails **closed** in the ways that matter: the ECS task will not start without a resolvable secret ARN, and `/api/public/site-config` 503s without the contact addresses. The one that fails **open** is Mapbox — an absent `GEOCODING_API_KEY` silently omits the geocode tools (`tools.service.ts:544-548`) while maps keep rendering, so its absence is invisible until a user asks for a geocode. **Lean: the runbook's verification step must call a geocode explicitly**, since nothing else will notice.
- **Scale & unbounded growth.** The metered vendors are the exposure: `bulk_geocode_records` fans out across a column and `web_search` is per-call. The cost gate meters against org quota, but the **vendor bill is ours**, so a tier misconfiguration becomes an unbounded spend. **Lean: account-level caps at every vendor**, as a backstop independent of application logic — the gate protects revenue, the cap protects solvency.
- **Multi-tenancy.** Nothing here is per-tenant; these are environment-level credentials shared by every org. The relevant isolation is between *environments*, and it is enforced by path prefix (`portalai/prod/*` vs `portalai/dev/*`) plus a distinct deploy role, since prod shares dev's AWS account by decision. **Lean: no per-org dimension**, but D5's per-env OAuth clients matter precisely because they are the last would-be cross-environment credential.
- **Contract stability.** Adding `prod` to `BUILTIN_ENVIRONMENTS` is the shape the registry was designed for from day one — the guards, prefixes and naming helpers are all `kind`- and `envName`-driven, so no call site changes. **Lean: additive only.** A future environment is one more entry.
- **Data lifecycle.** `NAMESPACE` and `SYSTEM_ID` are effectively **immutable once data exists** — they seed deterministic uuidv5 generation, so changing either orphans existing ids. Likewise, repointing prod at a different Stripe account orphans every `stripe_customer_id`. **Lean: treat both as write-once and say so at the point of writing**, not in a footnote.

## What this doesn't decide

- **The AWS stacks themselves** (#383) — this ticket produces the values they consume. The one interleaving is called out below.
- **Stripe live mode** (#385) — its two secrets are written through this ticket's catalog path, but the account, restricted key, webhook and tax configuration are that ticket's.
- **The tier amounts and allocations** (#325).
- **Live guard verification and the "pending #83" documentation sweep** (#387) — this ticket adds the registry entry those guards need; proving them against a real environment is the close-out child's job.
- **Auth0 connection providers beyond parity with dev** — #199 is open and independent; prod mirrors whatever dev has when this lands.

## A correction to the epic's sequencing

The epic's dependency map draws `#384 → #383` as a clean arrow. The survey shows it is not clean: **`DATABASE_URL` cannot be composed until the database stack exists**, because the value needs the RDS endpoint and the RDS-managed master password (`database.yml:73,85-98`). The real order interleaves:

```
#384 (all keys except DATABASE_URL)
  → #383 portalai-prod-database
    → #384 DATABASE_URL  ← this ticket, resumed
      → #383 portalai-prod-backend  (needs all twelve ARNs)
```

The spec should state this explicitly and the epic's Status table should carry it, so nobody reads #384 as "finished" before #383 starts. It is also the strongest argument for Decision 2's resumable per-key writes: this ticket is *designed* to be paused in the middle.

## Next step

`/spec 384` writes the contract — the registry entry, the one new CLI subcommand and its guard behavior, the exact key-by-key provisioning order with its interleave point, and the acceptance checks. `/plan 384` then slices it into commits: (1) the `prod` registry entry plus its guard tests, (2) `db url`, (3) the runbook. The vendor-console work itself is not a commit — it is the runbook's content, executed by an operator, and verified by the smoke checklist.
