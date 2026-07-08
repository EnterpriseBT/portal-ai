# Uniform Tool Cost Gate — Smoke Suite

Manual smoke test plan for [#169](https://github.com/EnterpriseBT/portal-ai/issues/169) — the enforcement gate. Covers charge-on-allow (usage increments), deny-at-quota + deny-at-rate (as a tool result the agent relays, not a dead turn), `free` immunity, the who-pays rule (custom/webhook tools never charged), and fail-open. Builds on the shipped #172 balance.

**Branch under test:** `feat/tool-cost-gate` (PR [#171](https://github.com/EnterpriseBT/portal-ai/pull/171)).

**Setup trick:** rather than making 1000 calls, we shrink the `standard` tier's allocations to tiny numbers via SQL, drive a few tool calls from a portal chat, then reset. The gate is agent-driven — you drive the portal chat; API/DB checks (SQL, token'd `/organization/usage`) are driven alongside.

Filing bugs: `gh issue create --repo EnterpriseBT/portal-ai`, type `Bug`, link the section.

---

## Preflight

- [ ] `git checkout feat/tool-cost-gate && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`
- [ ] Migrations from #172 are applied (`tiers`, `usage`, `organizations.tier`) — `npm run db:migrate` (no new migration in #169).
- [ ] `npm run dev` running the branch (API :3001, web :3000). If it was already running, **restart** so the gate wiring is live.
- [ ] Redis reachable (the rate half uses it).
- [ ] A station exists with the **`web_search`** pack enabled (the metered built-in) **and** `TAVILY_API_KEY` set — this is the easiest app-paid tool to trigger from chat. *(If no Tavily key: substitute an `expensive` tool — enable `regression`/`statistics` and ask for a regression/cluster over a loaded entity; the gate treats `expensive` identically.)*
- [ ] A bearer token (DevTools → Network → any `/api` request → `Authorization`). Paste it so the `/organization/usage` reads can run.
- [ ] `npm run db:studio` (from `apps/api/`) open for SQL + row inspection.
- [ ] Org id handy: `SELECT id, tier FROM organizations;`

**Shrink the standard tier for easy testing** (reset in Post-conditions):
```sql
UPDATE tiers SET metered_units_per_period = 2, metered_rate_per_min = 100,
                 expensive_units_per_period = 2
WHERE slug = 'standard';
```
Wait ~60s (the `resolveTier` cache TTL) or restart the API after any `tiers` edit.

---

## §1 — Charge on allow (usage increments)

- [ ] `GET /api/organization/usage` → `metered.used = 0`, `available = 2`.
- [ ] In a portal chat on the web_search-enabled station, ask something that makes the agent search the web (e.g. **"search the web for the latest SEC filing deadline"**). The agent calls `web_search`, returns an answer.
- [ ] `GET /api/organization/usage` → `metered.used = 1`, `available = 1`. (The gate charged 1 unit.)
- [ ] Settings → Organization → **Metered usage** shows `1 used · 1 available`.
- [ ] `db:studio` → `usage`: one row `(org, YYYY-MM, metered, units_used=1)`.

## §2 — Deny at quota (typed result, agent relays)

- [ ] Ask for another web search (2nd metered call → `used` would hit 2 = allocation; a 3rd exceeds). Drive one more so `used = 2`, then one more.
- [ ] The **over-quota** call is denied: the agent's turn does **not** die — it relays a message like "the monthly search allocation is exhausted" (the `TOOL_USAGE_QUOTA_EXCEEDED` result). The tool result (in the transcript / tool panel) carries `error.code = TOOL_USAGE_QUOTA_EXCEEDED`.
- [ ] `usage.metered.used` stays at `2` (the denied call did **not** charge).
- [ ] Tavily was **not** hit for the denied call (no external spend) — the gate denied before `execute`.

## §3 — `free` tools are immune

- [ ] With metered (and expensive) exhausted, ask a `free`-tool question: **"what time is it?"** (→ `current_time`) or anything using `station_context`.
- [ ] It **works** — `free` tools are never denied, never rate-limited, never charged. `usage` has no `free` row (or it stays 0/unused).

## §4 — Rate limit (per-minute)

- [ ] `UPDATE tiers SET metered_rate_per_min = 1, metered_units_per_period = 1000 WHERE slug='standard';` (raise quota so rate is what bites); wait the TTL / restart.
- [ ] Reset usage: `DELETE FROM usage WHERE organization_id='<org>';`
- [ ] Fire two web searches in quick succession (same minute). The **second** is denied with `TOOL_USAGE_RATE_LIMITED` (the agent relays "rate limit … retry shortly"), `retryAfter` present.
- [ ] The rate-denied call did **not** charge the quota (`metered.used` reflects only allowed calls).

## §5 — Who-pays: custom/webhook tools are never charged

- [ ] Enable a **custom toolpack** on the station with a tool declaring `capability.costHint: "metered"` (register one per `docs/CUSTOM_TOOLPACK_INTEGRATION.md`, or reuse an existing org toolpack).
- [ ] In the tool's description (visible in the `/toolpacks` modal, or the agent's tool list) the **advisory** note appears: "organization-provided tool … may be costly …".
- [ ] Drive the agent to call the custom tool. It runs (hits the org's webhook).
- [ ] `GET /api/organization/usage` → **`metered.used` is unchanged** — the custom tool charged **0** units (org-paid). No `usage` write for it.

## §6 — Fail-open (Redis down)

- [ ] (Optional, if you can stop Redis locally.) Stop Redis; drive a metered call within quota.
- [ ] The call still **works** — the rate check fails open (logged warning `cost gate infra error; failing open`), and the quota (Postgres) still enforces. Restart Redis.

## §7 — No audit ledger (deferred #179)

- [ ] There is **no** per-call ledger table in this ticket (`\dt` shows no `tool_usage_ledger`). #169 charges the aggregate `usage` balance only; the itemized per-call trail is #179 (post-Stripe).

---

## Post-conditions / reset

- [ ] Reset the tier: `UPDATE tiers SET metered_units_per_period = 1000, metered_rate_per_min = 20, expensive_units_per_period = 100 WHERE slug='standard';`
- [ ] Clear test usage: `DELETE FROM usage WHERE organization_id='<org>';`
- [ ] Wait the TTL / restart so the reset tier is live.

---

## Sign-off

- [ ] §1 charge-on-allow · §2 quota-deny (relayed, no double-charge, no upstream spend) · §3 free immune · §4 rate-deny · §5 custom never charged + advisory shown · §6 fail-open · §7 no ledger.

## Bug-filing template

```
**Section:** §<X>
**Expected:** <what the doc says>
**Got:** <transcript / usage rows / /organization/usage body>
**Repro:** <prompt + tier SQL state>
**Org id / period:** <from db:studio>
```
