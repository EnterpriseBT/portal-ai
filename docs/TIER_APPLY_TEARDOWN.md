# portalops tier apply teardown — Condensed design (#242)

**Issue:** [EnterpriseBT/portal-ai#242](https://github.com/EnterpriseBT/portal-ai/issues/242) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalops tier apply --env app-dev [--dry-run]` computes and prints its plan correctly, then **hangs indefinitely** — the process never exits, so any non-interactive/CI wrapper blocks until externally killed and an operator must Ctrl-C every run. The `work` is correct; this is purely a process-lifecycle defect: the SSM tunnel opened for the DB connection is never torn down, leaving a live child process that keeps the Node event loop alive. Single package (`@portalai/devops-cli`), no contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The leak | `packages/devops-cli/src/commands/tier.ts:241–248` | default `openStore` calls `resolveEnvConnection(def.name)` + `connection.db()` (opens the tunnel) but the returned store's `close()` never disposes `connection` — the `connection` ref is orphaned |
| `TierStore.close()` | `tier.ts:191–194` | only `client.end()` — ends the postgres pool, **not** the tunnel |
| `tierApply` finally | `tier.ts:274–276` | `await store.close()` only — no `connection.dispose()` |
| Connection lifecycle | `packages/cli-env/src/connection.ts:56–61,99` | `dispose()` is what calls `tunnel.close()`; it is idempotent. For AWS envs `handle.close === dispose`; for local it's a no-op |
| Reference teardown | `packages/devops-cli/src/commands/db.ts:91–109` (`dbPsql`) | resolves the connection, does its work, disposes in a `finally` — exits cleanly. This is the pattern `tier apply` should mirror |
| Entrypoint lifecycle | `packages/devops-cli/src/bin.ts:305–309` | sets `process.exitCode` and lets the event loop drain (no `process.exit()`) — so a leaked handle hangs the process |
| Stripe client | `packages/devops-cli/src/stripe.ts:66–85` | one `prices.list` over Node's default (non-keepalive) agent; sockets close after the request — **not** a source of the hang |

## Decision — dispose the connection in the store's `close()`, mirror `db psql`

Two ways to fix: (A) call `process.exit()` in the entrypoint after the result flushes, or (B) make `tier apply` tear down what it opened so the loop drains on its own.

**Decision: B.** `process.exit()` is a blunt instrument that can truncate in-flight stdout writes and masks future leaks; `db psql` already exits cleanly by disposing in a `finally`, and that is the house pattern. The tunnel is opened inside the default `openStore` closure, so that closure owns disposing it: extract it into a named, testable `openEnvTierStore(envName, resolve?)` whose returned store's `close()` tears down **both** the postgres client and the connection/tunnel (client first, connection in a `finally` so a client-close error still frees the tunnel). `connection.dispose()` is idempotent and a no-op for local, so this is safe on every env and every path (dry-run, all-noop, real apply, throw). The injectable `resolve` parameter makes the disposal unit-testable without a real tunnel.

## Plan — one slice

**Files**
- Edit: `packages/devops-cli/src/commands/tier.ts` — add exported `openEnvTierStore(envName: string, resolve = resolveEnvConnection): Promise<TierStore>` that opens the connection + `db()`, builds `createTierStore(handle.connectionString)`, and returns a store whose `close()` does `try { await store.close() } finally { await connection.dispose() }`. Replace the inline default in `tierApply` (`tier.ts:241–248`) with `deps.store ?? (() => openEnvTierStore(def.name))`.

**Tests**
- Edit: `packages/devops-cli/src/__tests__/tier.test.ts` — add a case: `openEnvTierStore` with an injected `resolve` returning a fake `EnvConnection` (spy `db` → fake connection string + spy `dispose`); assert that after `store.close()` the connection's `dispose()` was called exactly once, and that it's still called when the underlying client close rejects (finally semantics). The existing `deps.store` injection cases already cover diff/dry-run/guard/audit unchanged.
- `npm run test:unit` (devops-cli), `npm run type-check`, `npm run lint`, `npm run format:check`.

## Smoke (manual, against your dev stack)

1. Establish app-dev AWS creds (`aws login --remote`, then `eval "$(aws configure export-credentials --format env)"`); rebuild dist (`npm run build` in `packages/devops-cli`, since `npx portalops` runs `dist/`).
2. `npx portalops tier apply --env app-dev --dry-run` → plan prints **and the command exits on its own**, returning the shell prompt with exit code `0` (no `timeout`/Ctrl-C needed). Confirm with `echo $?` = `0`.
3. `npx portalops tier apply --env app-dev --json --dry-run` → single JSON payload on stdout, process exits promptly.
4. Sanity that clean-exit didn't break the work: `npx portalops db psql --env app-dev -- -tAc "select 1"` still returns `1` and exits (the reference path, unchanged).
5. (If a real drift exists and you're willing) `npx portalops tier apply --env app-dev --yes` → applies, prints `applied`, and exits cleanly.

## Out of scope

- `process.exit()`-based teardown anywhere in the CLI — rejected in favor of clean handle disposal (Decision above).
- Any change to `db tunnel`'s deliberate hold-open behavior (`bin.ts:186`) — that command is *meant* to stay open until Ctrl+C.
- Auditing other commands for leaks — `db psql` is verified clean; a broader teardown audit is a separate ticket if warranted.
