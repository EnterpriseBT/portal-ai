# Portal.ai CLI Operations Charter

The standing **operation → CLI index** for maintaining, inspecting, and configuring Portal.ai environments (`local`, `app-dev`, and future `prod`), usable by a **human or a Claude agent**. Every relevant maintenance, logging, and configuration task appears once, mapped to its owning CLI, rated operable or not, and pointed at the per-surface guide that carries the full runbook.

This charter is a **thin index**, not a runbook. It answers *"which CLI, and roughly how"* and reports coverage; the exact commands, flags, examples, auth setup, and allowlists live in the four per-surface guides:

| Surface | Guide | Owning CLI(s) |
|---|---|---|
| AWS | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | `aws` |
| Stripe | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | `stripe` |
| Auth0 | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | `auth0` |
| Native | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | `portalops`, `portalai` |

> **Priority:** AWS and Auth0 are where operator console time concentrates — they are the surfaces this charter (and its guides) covers most thoroughly.

## How to read this

Each surface below carries one operations table. Every row is one operation, with these columns:

| Column | Meaning | Allowed values |
|---|---|---|
| **Operation** | The task an operator/agent actually asks for, in imperative phrasing (e.g. "Tail app-dev API logs for an error"). | free text |
| **Category** | Which kind of work; drives the coverage denominator (logging reported separately). | `maintenance` · `logging` · `configuration` |
| **Envs** | Which environments the operation applies to. | subset of `local` · `app-dev` · `prod` |
| **Owning CLI** | The one CLI that performs it. | `aws` · `stripe` · `auth0` · `portalops` · `portalai` |
| **Command** | A canonical, copy-paste one-liner **including any guard flags** — the starting point; the full runbook is in the guide. `—` if none exists. | command or `—` |
| **Operable?** | Whether the operation meets the CLI-operable predicate (below) in **every** env it applies to. | `yes` · `no` |
| **Guide ref** | Link to the per-surface guide section with the full command/flags/examples. | link or `—` |
| **Disposition** | The classification of the row — never blank. | `covered` · `gap → #<n>` · `exception: <reason>` · `deploy-infra: <reason>` |

**CLI-operable predicate.** An operation is **operable** iff **all three** hold:

1. **A documented command exists** — native (`portalops`/`portalai`) or vendor-CLI (`aws`/`stripe`/`auth0`).
2. **Non-interactive or flag-guarded** — runnable without an interactive-only prompt; confirmations are explicit flags (`--yes`, `--confirm-prod`). A REPL/hold-open with a documented one-shot form (e.g. `portalops db psql -- <sql>`) counts as operable via that form.
3. **Machine-readable output** — emits JSON (`--json` / `--output json`) or the guide documents how to parse it.

`Operable? = yes` requires the predicate to hold in **every** environment listed in `Envs`. An operation operable in `local` but not `app-dev` is a **parity defect** — rated `no`, with the disposition naming the missing environment.

**Coverage bar.** Let `D` = the count of `maintenance` + `configuration` operations (logging excluded) and `N` = those rated `operable`. The bar passes iff:

- `N / D ≥ 0.90`, **and**
- every operation in the whole table (all categories) has a non-blank `Disposition` (100% classified).

The [Coverage](#coverage) section reports `N/D` as a fraction and percent, the logging sub-figure separately, and any parity defects. Numbers are reported honestly — a shortfall is enumerated and routed, never rounded up to clear the bar.

**Guard convention.** Per-environment guard expectations are not a separate column — they live inline in the `Command` as the flags the task actually needs: `--yes` for `app-dev` (staging) mutations; `--yes --confirm-prod` for the future prod non-destructive case; destructive `prod` operations are shown as blocked, not as a runnable command. There is no actor/role tagging — authentication is configured per-env and the human drives the session, so every operable row is assumed unattended-operable.

**Overlap rule (compose-test).** Native-over-vendor glue is allowed **only** when the native command *composes* vendor primitives into a Portal-domain operation; a thin passthrough of a vendor CLI is rejected (use the vendor CLI directly, per its guide). See [Overlap decisions](#overlap-decisions).

## AWS

_Auth: ambient AWS credentials (SSO / `AWS_PROFILE` / CI OIDC); per-env scoping is the ability to act on that env's resources. Full runbook: [#224](https://github.com/EnterpriseBT/portal-ai/issues/224)._

<!-- Table populated in slice 2. -->

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|

## Auth0

_Auth: `auth0` CLI, authenticated per-env (tenant). Full runbook: [#226](https://github.com/EnterpriseBT/portal-ai/issues/226)._

<!-- Table populated in slice 2. -->

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|

## Stripe

_Auth: `stripe` CLI with a per-env (restricted) key. Full runbook: [#225](https://github.com/EnterpriseBT/portal-ai/issues/225)._

<!-- Table populated in slice 3. -->

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|

## Native (`portalops` / `portalai`)

_Auth: `cli-env` — AWS-IAM (infra/DB) + Auth0 device-flow (app API); `--env` required on every command. Full runbook: [#227](https://github.com/EnterpriseBT/portal-ai/issues/227)._

<!-- Table populated in slice 3. -->

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|

## Common workflows

_Cross-surface recipes for tasks that span CLIs — the one piece of substance this charter owns rather than delegating to a guide. Populated in slice 4 (starting with "add a subscription tier")._

## Overlap decisions

_The compose-test rule (above) plus the recorded native-over-vendor precedent cases and the standing rule for any future overlap. Populated in slice 3._

## Gap list & findings

_Every `Operable? = no` row plus recorded findings, each with a disposition. Populated in slice 3._

## Coverage

_The computed `N/D` for maintenance + configuration, the logging sub-figure, and any parity defects, against the coverage bar. Populated in slice 4._
