# Auth0 CLI operations guide — Smoke Suite

Manual smoke for [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) — the Auth0 CLI operations runbook (`docs/AUTH0_CLI_OPS.md`), its read-only `.claude` allowlist, and the stale-config cleanup. **Branch under test:** `feat/auth0-cli-ops-guide` (PR [#246](https://github.com/EnterpriseBT/portal-ai/pull/246) → `epic/cli-first-ops`).

The deliverable is documentation + config, so this smoke proves the guide is *true*: the guide's inspection commands actually run against your **app-dev** Auth0 tenant with JSON output (after the documented banner strip), the allowlist runs reads without a prompt (and still gates mutations), and the stale config is gone. You run these against **your own** Auth0 tenant. Boxes start unchecked; checking them is your confirmation.

## Preflight

### Environment

- [ ] `git checkout feat/auth0-cli-ops-guide && git pull --ff-only`
- [ ] `npm install` — **no build, no migration** (deliverable is a markdown doc + JSON allowlist + `.env.example`/README edits).
- [ ] Open `docs/AUTH0_CLI_OPS.md` to follow along.

### Tooling & auth

- [ ] `auth0` CLI installed (v1.3x).
- [ ] Authenticated to the **app-dev** tenant per the guide: `auth0 login` (or read-only M2M `auth0 login --domain … --client-id … --client-secret …`), then `auth0 tenants use portalsai-staging.us.auth0.com` and `auth0 tenants list --json` shows it active.

### Fixtures

- [ ] A known user email exists in the app-dev tenant to look up (any real one — these steps are read-only). The optional §4 mutation is clearly marked.

### Reset between runs

- [ ] **No reset needed** — every step is read-only except the clearly-marked optional §4 mutation check (which you decline).

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

## §3 — Allowlist runs reads without a prompt, still gates mutations *(AC3)*

The allowlist loads at **session start** — check in a **fresh Claude Code session** on this branch.

- [ ] In a fresh session, an allowlisted read (ask the agent to run `auth0 logs list --number 5 --json`) executes with **no permission prompt**.
- [ ] A non-allowlisted mutation still prompts: asking the agent to run `auth0 users update <user-id> …` (or `auth0 tenants use <other-tenant>`) raises a permission prompt (**decline it**).
- [ ] `jq -r '.permissions.allow[] | select(startswith("Bash(auth0"))' .claude/settings.local.json | wc -l` returns `9`, and none of `users update` / `users delete` / `users roles add` / `apps update` / `tenants use` / `login` appear.

## §4 — Scope & coverage *(AC4)*

- [ ] Every Auth0 row in the charter's Auth0 table (14) appears in `docs/AUTH0_CLI_OPS.md` — as a runnable command or under the prompt-gated management section. *(AC4)*
- [ ] Mutating verbs (`users update/delete`, `users roles add`, `apps update`) appear **only** under "Management operations (prompt-gated)".
- [ ] The `portalai login` vs `auth0 login` distinction and the RBAC-not-enforced future-note are both present in the guide.

## §5 — Gotchas are real

- [ ] **Separate tenants:** a `user_id` found in app-dev is **not** found in the local tenant — `auth0 tenants use dev-ow7j1wh6zixlfcp1.us.auth0.com` then `auth0 users show <app-dev-user-id>` errors / not found, confirming the guide's "ids don't cross tenants" warning. (Switch back with `auth0 tenants use portalsai-staging.us.auth0.com`.)
- [ ] **`tenants use` is sticky:** after switching, a subsequent `auth0 users search …` runs against the *new* active tenant — confirming why it's kept out of the allowlist.

## Sign-off

- [ ] §1 stale config gone (`.env.example` + README)
- [ ] §2 guide operable from the doc alone (reads return JSON after banner strip)
- [ ] §3 allowlist runs reads no-prompt; mutations + `tenants use` still prompt (fresh session)
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
