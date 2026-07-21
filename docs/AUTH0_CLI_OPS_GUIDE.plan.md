# Auth0 CLI operations guide — Plan

**Sequences the #226 contract into three doc/config slices: the stale-config cleanup, the `docs/AUTH0_CLI_OPS.md` runbook, and the read-only `auth0` allowlist.**

Spec: `docs/AUTH0_CLI_OPS_GUIDE.spec.md`. Discovery: `docs/AUTH0_CLI_OPS_GUIDE.discovery.md`. Issue: #226 (epic #222).

Three slices, each leaving the tree valid and each landing as a **commit on `feat/auth0-cli-ops-guide` / PR #246** (base `epic/cli-first-ops`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

**Note on "TDD" for this ticket.** Docs + JSON-config change — no code to unit-test, and no pinning test covers `docs/*.md` / `settings.local.json` / READMEs (spec's TDD test plan ≈ 0 automated cases). Each slice's "test" step is its concrete **verification gate**: `grep` for the cleanup, doc-consistency for the guide, `jq` validity + count for the allowlist, and the manual `/smoke 226` (merge gate). Inventing jest coverage here would be wrong (`feedback_smoke_test_is_manual_doc`, `feedback_use_npm_test_scripts`).

Sequencing rationale — smallest-and-independent first; the guide defines the canonical inspection commands, then the allowlist codifies the read subset (no forward dep):

- **Slice 1** — the stale-config cleanup (2 files), independent of everything else; smallest.
- **Slice 2** — `docs/AUTH0_CLI_OPS.md`, the full runbook. Depends only on the pinned surface.
- **Slice 3** — the read-only `auth0` allowlist + validity + acceptance reconcile. Last, because it allowlists the exact read verbs the guide (slice 2) canonicalizes.

---

## Slice 1 — Stale Auth0 config cleanup

Drop the old `mcp-ui` audience and the nonexistent `AUTH0_ISSUER` var so the app-config docs match reality.

**Files**

- Edit: `apps/api/.env.example` (line 8) — `AUTH0_AUDIENCE=https://api.mcp-ui.dev` → `AUTH0_AUDIENCE=https://api.portalsai.local`.
- Edit: `apps/api/README.md` (line 29) — remove the stale `AUTH0_ISSUER=https://your-domain.auth0.com/` line (the API derives the issuer from `AUTH0_DOMAIN` via `issuerBaseURL`, `auth.middleware.ts:12-15`); ensure `AUTH0_DOMAIN` is present in that snippet.

**Steps**

1. **Verification (spec test-plan case 2).** `grep -rn 'mcp-ui' apps/api/.env.example` returns nothing; `grep -n 'AUTH0_ISSUER' apps/api/README.md` returns nothing; the README snippet still lists `AUTH0_DOMAIN` + `AUTH0_AUDIENCE`.
2. **Implement** the two edits.
3. Done — docs only.

**Done when:** no `mcp-ui` in `.env.example`; no `AUTH0_ISSUER` in the README; the env snippet is internally consistent.

**Risk:** none — placeholder/doc edits; no runtime var is renamed (the app never read `AUTH0_ISSUER`).

---

## Slice 2 — `docs/AUTH0_CLI_OPS.md` runbook

The guide itself — one new file, in the section order spec Surface §A pins.

**Files**

- New: `docs/AUTH0_CLI_OPS.md` — purpose/boundary → two-logins callout → auth (human device pairing + read-only M2M, per-env separate tenants, `auth0 tenants use`) → invariants (`--json` banner strip) → logging ops → inspection ops → management ops (prompt-gated) → RBAC future-note → gotchas → prod.

**Steps**

1. **Verification (doc-consistency, spec case 4).** Author, then confirm: all **14** charter Auth0 rows appear as documented commands (or deferred); the `portalai login` vs `auth0 login` distinction is stated; the `--json` banner-strip recipe is in the invariants; the read-only M2M scope list is named; mutating verbs sit only under the prompt-gated management section; the RBAC future-note is one line.
2. **Author** the sections. No code.
3. `npm run format` (markdown excluded from the hook; keep prose clean); confirm links resolve.

**Done when:** the guide covers all 14 charter Auth0 ops; a reader can authenticate to the app-dev tenant (either auth path) and run a logging + an inspection read from the doc alone.

**Risk:** conflating the two logins — mitigated by leading with the explicit callout.

---

## Slice 3 — read-only `auth0` allowlist + acceptance reconcile

Codify the safe read subset; mutations and `tenants use` stay gated.

**Files**

- Edit: `.claude/settings.local.json` — append the 9 read-only `auth0` matchers from spec Surface §B to `permissions.allow`.

**Steps**

1. **Tests / verification gate (spec case 1).**
   - `jq empty .claude/settings.local.json` parses clean.
   - `jq -r '.permissions.allow[] | select(startswith("Bash(auth0"))' .claude/settings.local.json | wc -l` returns `9`.
   - Excluded verbs absent: `users update`, `users delete`, `users roles add`/`rm`, `apps update`, `tenants use`, `login`.
2. **Implement** — append the 9 entries.
3. **Acceptance reconcile** — walk the spec's Acceptance criteria; every box maps to a landed artifact (cleanup, guide, allowlist) or the smoke.

**Done when:** `jq` validates; 9 read verbs present, the excluded verbs absent; acceptance criteria all mapped.

**Risk:** allowlist too broad — mitigated by read-only-only + fail-closed (unlisted verbs, incl. `tenants use`, prompt); a read-only M2M session cannot mutate regardless.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `.env.example` + README stale-config cleanup | `grep` finds no `mcp-ui` / `AUTH0_ISSUER` |
| 2 | `docs/AUTH0_CLI_OPS.md` runbook | doc-consistency vs 14 charter rows; login distinction + banner strip |
| 3 | 9 read-only `auth0` allow-entries | `jq empty` valid; 9 present / excluded absent |
| gate | — | `/smoke 226` against the app-dev tenant (merge gate) |

## Cross-slice notes

- **No migration / seed / code** — pure docs + config; no `db:generate`, no jest, no CI test additions.
- **Allowlist timing** — permission entries take effect at session start; a fresh session is needed for the no-prompt behavior (the smoke notes this).
- **Doc-sync:** the guide is a new surface; the charter's Auth0 Guide-ref stays pointing at #226 (uniform with the other surfaces linking issues) — flip to the doc when all guides land, same call as #224/#225. Slice 1 keeps the app-config docs (`.env.example`/README) in sync per `CLAUDE.md` → "Keeping Documentation in Sync".

## Next step

Implementation begins on this branch — slice 1 (cleanup) → slice 2 (runbook) → slice 3 (allowlist) — only after you've confirmed discovery + spec + plan. The `/smoke 226` checklist follows as the merge gate.
