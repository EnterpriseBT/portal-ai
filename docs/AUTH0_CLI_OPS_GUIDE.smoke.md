# Auth0 CLI operations guide — Smoke Suite

Manual smoke for [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) — the Auth0 CLI operations runbook (`docs/AUTH0_CLI_OPS.md`), its read-only `.claude` allowlist, and the stale-config cleanup. **Branch under test:** `feat/auth0-cli-ops-guide` (PR [#246](https://github.com/EnterpriseBT/portal-ai/pull/246) → `epic/cli-first-ops`).

The deliverable is documentation + config, so this smoke proves the guide is *true*: the guide's inspection commands actually run against your **app-dev** Auth0 tenant with JSON output (after the documented banner strip), the allowlist auto-runs reads (prompt-reduction), the **read-only credential** is the real mutation gate (a permission prompt is not), and the stale config is gone. You run these against **your own** Auth0 tenant. Boxes start unchecked; checking them is your confirmation.

## Preflight

### Environment

- [ ] `git checkout feat/auth0-cli-ops-guide && git pull --ff-only`
- [ ] `npm install` — **no build, no migration** (deliverable is a markdown doc + JSON allowlist + `.env.example`/README edits).
- [ ] Open `docs/AUTH0_CLI_OPS.md` to follow along.

### Tooling & auth

- [ ] `auth0` CLI installed (v1.3x).
- [ ] Authenticated to the **app-dev** tenant per the guide: `auth0 login` (or read-only M2M `auth0 login --domain … --client-id … --client-secret …`), then `auth0 tenants use portalsai-staging.us.auth0.com` and `auth0 tenants list --json` shows it active.

### Fixtures

- [ ] A known user email exists in the app-dev tenant to look up (any real one — these steps are read-only).
- [ ] For §3's credential-gate check, a **read-only M2M** credential for the app-dev tenant (see the guide's Auth section).

### Reset between runs

- [ ] **No reset needed** — every step is read-only; §3's mutation check runs under a **read-only** credential (Auth0 rejects it with 403), so nothing is written.

## §1 — Stale-config cleanup *(AC5)*

- [ ] `grep -rn 'mcp-ui' apps/api/.env.example` returns **nothing**; `sed -n '8p' apps/api/.env.example` shows `AUTH0_AUDIENCE=https://api.portalsai.local`.
- [ ] `grep -n 'AUTH0_ISSUER' apps/api/README.md` returns **nothing**; the README env snippet now lists `AUTH0_DOMAIN` (the var the app actually reads).

## §2 — Guide is operable from the doc alone *(AC1, AC2)*

Follow **only** `docs/AUTH0_CLI_OPS.md` (with the app-dev tenant selected).

- [ ] **Logging:** `auth0 logs list --filter "type:f" --number 10 --json` returns failed-login events as JSON (after stripping the `=== <tenant>` banner per the guide). *(AC1)*
- [ ] **Find a user:** `auth0 users search --query "email:<known-email>" --json | sed '1,/^\[/{/^\[/!d}' | jq .` returns that user as JSON. *(AC1, AC2)*
- [ ] **Banner-strip works as documented:** the raw command emits a `=== <tenant> users` header + blank line before the `[`, and the guide's `sed`/`awk` recipe removes it so `jq` parses. *(AC2)*
- [ ] **Roles/apps/apis reads:** `auth0 roles list --json`, `auth0 apps list --json`, `auth0 apis list --json` each return JSON.
- [ ] **Auth section works as written:** you reached this using only the guide's auth path (device pairing or read-only M2M) with the right tenant selected.

## §3 — Allowlist auto-runs reads; the read-only credential gates mutations *(AC3)*

The allowlist loads at **session start**, so check the read behavior in a **fresh Claude Code session** on this branch. **The allowlist is prompt-reduction for reads — it is NOT the mutation gate.** The mutation gate is the **read-only M2M credential** (Auth0 rejects writes server-side); a permission prompt is *not* a reliable gate (it's bypassable per session mode — a normal session was observed running a non-allowlisted `auth0 users update` with no prompt).

- [ ] **Reads auto-run:** in a fresh session, an allowlisted read (`auth0 logs list --number 5 --json`) executes with **no permission prompt**.
- [ ] **The credential is the real gate:** authenticated with the **read-only M2M** (not admin device-pairing), `auth0 users update <user-id> --json` is **rejected by Auth0 (403 / insufficient_scope)** — the write cannot happen regardless of any prompt. This is the server-enforced boundary.
- [ ] `jq -r '.permissions.allow[] | select(startswith("Bash(auth0"))' .claude/settings.local.json | wc -l` returns `9`, and no mutating verb (`users update`/`delete`, `users roles add`, `apps update`, `tenants use`, `login`) is allowlisted (defense-in-depth: it keeps agents from *auto-running* writes even with a write credential, but the credential is the actual gate).

## §4 — Scope & coverage *(AC4)*

- [ ] Every Auth0 row in the charter's Auth0 table (14) appears in `docs/AUTH0_CLI_OPS.md` — as a runnable command or under the write-credential management section. *(AC4)*
- [ ] Mutating verbs (`users update/delete`, `users roles add`, `apps update`) appear **only** under "Management operations (require a write credential)", with the safety-model note (credential is the gate, not the prompt).
- [ ] The `portalai login` vs `auth0 login` distinction and the RBAC-not-enforced future-note are both present in the guide.

## §5 — Gotchas are real

- [ ] **Separate tenants (tenant-scoped ids):** application `client_id`s differ per tenant — `auth0 apps list --json` (banner-stripped) in `portalsai-staging` vs `dev-ow7j1wh6zixlfcp1` shows **different** client_ids for the same app names (e.g. "Portal CLI"). (Switch back with `auth0 tenants use portalsai-staging.us.auth0.com`.)
- [ ] **Social-id nuance (verified during authoring):** a `google-oauth2|…` **user** id is the *provider's* account id and resolves in **both** tenants (the same person logged into each) — so a social `user_id` is not a "which tenant" signal. Confirms the guide's corrected gotcha.
- [ ] **`tenants use` is sticky:** after switching, a subsequent `auth0 users search …` runs against the *new* active tenant — confirming why it's kept out of the allowlist.

## Sign-off

- [ ] §1 stale config gone (`.env.example` + README)
- [ ] §2 guide operable from the doc alone (reads return JSON after banner strip)
- [ ] §3 allowlist auto-runs reads (fresh session); the read-only credential rejects a mutation (Auth0 403)
- [ ] §4 scope/coverage holds; mutations flagged management-only
- [ ] §5 gotchas are real
- [ ] Any command/identifier corrections noted for the guide
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template

```
Section:     (e.g. §2 guide operable)
Expected:    (per docs/AUTH0_CLI_OPS.md — this exact command, this output shape)
Got:         (what actually happened)
Repro:       (exact command + tenant)
Identifiers: (tenant / user id / client id / role id)
Fix:         (correct the guide's command, the allowlist entry, or the config cleanup)
```
