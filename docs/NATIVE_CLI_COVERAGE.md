# Native Portal CLI coverage + contract docs — Condensed design (#227)

**Issue:** [EnterpriseBT/portal-ai#227](https://github.com/EnterpriseBT/portal-ai/issues/227) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Final child of epic #222.

**Why.** The charter (#223) confirmed the native CLIs (`portalops`/`portalai`) are **14/14 operable with no gaps**, and **declined** the audit-log reader (finding (b) — write-only log; centralized audit is #179). So there is **no code** to write. What remains is *discoverability*: the agent-operability contract lives in the package `COMMANDS.md`/READMEs but not in root `CLAUDE.md` (the file an agent reads first), and there's no `.claude/` allowlist for the native CLIs. This ticket documents the existing contract in `CLAUDE.md` (+ its `.github/copilot-instructions.md` mirror) and adds a conservative read-only allowlist. Docs + config only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `--env` required + `--json`/`--yes`/`--confirm-prod` flags | `packages/devops-cli/src/bin.ts:43-49`, `packages/admin-cli/src/bin.ts:36-41` | every command; invariants at both `COMMANDS.md:1-3` |
| stdout-clean (banner→stderr, payload→stdout) | `packages/devops-cli/src/output.ts:23-34` | error envelope `{"error":{code,message}}` (`:29-34`) |
| **Exit-code contract** | `packages/devops-cli/src/output.ts:10-21` (defined `packages/cli-env/src/errors.ts:9-19`) | `3` not-configured · `4` not-authorized · `5` confirmation-required · `6` destructive-blocked · `7` infra-error · `1` unknown · `2` usage; admin adds `8` not-found / `9` conflict (`admin-cli/src/output.ts:11-14`) |
| **Guard (server-enforced)** | `packages/cli-env/src/guard.ts:31-60` | keyed on env `kind`: dev unrestricted · staging needs `--yes` · prod destructive **blocked**, non-destructive needs `--yes --confirm-prod` |
| Device-flow session | `packages/cli-env/src/auth0.ts:118-236` | token cached `~/.portalai/credentials.json` (0600), transparent refresh |
| Audit-log append | `packages/cli-env/src/audit.ts:26-39` | best-effort JSONL `{ts,env,operator,command,args}` → `~/.portalai/audit.log` (write-only, per finding (b)) |
| `COMMANDS.md` (cross-link targets) | `devops-cli/COMMANDS.md` (invariants `:1-3`, exit table `:5-18`, guard matrix `:20-29`, commands `:33-102`); `admin-cli/COMMANDS.md` (`:1-28`, commands `:32-74`) | per-command `--json:` schema lines |
| Root `CLAUDE.md` CLIs | `CLAUDE.md:14-16` (package table only) | no operating section; no `COMMANDS.md` link anywhere |
| Copilot mirror | `.github/copilot-instructions.md:5` | names the CLIs; each section ends "See CLAUDE.md → …"; no CLI-ops section yet |
| Allowlist | `.claude/settings.local.json` `permissions.allow` | flat `Bash(<prefix>:*)`; vendor reads present (`:50-80`); **no native entry yet** |

## Decision — document the contract; allowlist only prefix-safe reads

1. **Root contract section.** Add "Operating the Portal CLIs" to `CLAUDE.md` (after **Environment URLs**, ~`:399`) stating the contract (`--env` required, `--json`, the exit-code table, the **server-enforced** `--yes`/`--confirm-prod` guards, device-flow session, write-only audit append) and cross-linking both `COMMANDS.md`. Mirror a condensed version into `.github/copilot-instructions.md` with a "See CLAUDE.md → …" pointer. **Native mutation safety is genuinely enforced** (the `--yes`/`--confirm-prod` guards live in `guard.ts`, server-side in the CLI) — unlike the vendor CLIs, whose safety is the read-only credential (per the charter guard convention). State that distinction.
2. **Conservative read-only allowlist.** Add only reads whose `Bash(<prefix>:*)` cannot also match a secret-exposing or mutating variant:
   - `Bash(portalops vars describe:*)` · `Bash(portalai org list:*)` · `Bash(portalai org get:*)` · `Bash(portalai user list:*)` · `Bash(portalai user get:*)`
   - **Excluded (and why):** `vars list` — its prefix also matches `vars list --unmask` (reveals secrets); `vars get` — returns raw unmasked value; `vars template` — writes plaintext secrets; `db psql` — arbitrary SQL; `db tunnel` — hold-open connect; `tier apply --dry-run` — prefix also matches the `tier apply --yes` mutation; all mutations — `--yes`-guarded server-side and stay prompt-gated. The prefix-reachability rule is the key call: if a safe read shares a prefix with an unsafe variant, it is **not** allowlisted.

## Plan — 2 slices

**Slice 1 — contract docs.** *Files:* `CLAUDE.md` (new "Operating the Portal CLIs" section), `.github/copilot-instructions.md` (mirror), `packages/devops-cli/COMMANDS.md` + `packages/admin-cli/COMMANDS.md` + package READMEs (add a cross-link back to the CLAUDE.md contract). *Verify:* section present; links resolve; the copilot-instructions pinning test (if any) + `npm run format:check` pass.

**Slice 2 — allowlist.** *Files:* `.claude/settings.local.json` (+5 native read entries). *Verify:* `jq empty` valid; `jq -r '.permissions.allow[]|select(test("portalops|portalai"))' | wc -l` = 5; none of `vars get`/`vars list`/`db psql`/`tier apply`/`org create` present.

## Smoke (manual, against your dev stack)

1. Open `CLAUDE.md` → find "Operating the Portal CLIs": it states `--env`/`--json`, the exit-code table, the `--yes`/`--confirm-prod` guards, and links both `COMMANDS.md`. An agent reading only `CLAUDE.md` can now operate both CLIs.
2. `.github/copilot-instructions.md` carries the mirrored section + "See CLAUDE.md →" link.
3. Contract spot-check (live): `npx portalops vars list --env app-dev --json` returns masked JSON; a guard-denied case (`npx portalops db reset --env app-dev` **without** `--yes`) exits `5` (`ENV_CONFIRMATION_REQUIRED`) with a `{"error":{code}}` envelope.
4. Allowlist (**fresh session** on this branch): `npx portalai org list --env app-dev --json` auto-runs with no prompt; `npx portalops vars get …`, `npx portalops db psql …`, and any mutation (`npx portalai org create …`) **do** prompt. `jq` count = 5.

## Out of scope

- **Native command gap-fill** — charter is 14/14 operable; nothing to build.
- **Audit-log query command** — declined (finding (b)); log stays write-only; centralized audit is #179.
- **Vendor CLIs** (#224/#225/#226); **live `prod`** (#83).
