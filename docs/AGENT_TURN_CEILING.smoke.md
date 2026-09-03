# agent-turn-ceiling — Smoke Suite

Manual smoke test for [#498](https://github.com/EnterpriseBT/portal-ai/issues/498) — the un-charged per-org agent-turn send ceiling (tier data: 3/min·9/day standard, 5/13 plus, 10/26 pro, enterprise unlimited), gated at the message POST before anything is written. **Branch under test:** `feat/agent-turn-ceiling` (PR [#503](https://github.com/EnterpriseBT/portal-ai/pull/503)).

## Preflight

### Environment

- [ ] `git checkout feat/agent-turn-ceiling && git pull --ff-only`
- [ ] `cd apps/api && npm run db:migrate` — applies **0090_add-agent-turn-ceilings** (nullable columns; local tiers stay unlimited until set)
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] CI green on PR #503 (`gh pr checks 503`)

### Fixtures

- [ ] The active dev org on a tier row whose `agent_turns_per_min = 1` for §2's denial (set + restore via `portalops db psql --env local`; exact SQL in §2)

### Reset between runs

- [ ] §2's minute window self-resets in 60s; restore the tier row after (§2 last step). Everything else read-only.

## §1 — Artifacts + model close (AC5)

- [ ] `docs/TIER_PRICING_MODEL.md` §5 shows the #498 update: T2 **pass** on plus ($56.7 ≤ $58) and pro ($197.4 ≤ $198); T3 stated honestly (≈$25.7 vs $25, standard→8/day recorded as the lever); §6 turn-ceiling verdict reads `implemented (#498)` — manual read
- [ ] All #495-descendant verdicts in §6 are terminal (implemented/rejected) — manual read

## §2 — The live gate (AC1, AC2 under-limit, AC6 copy)

- [ ] Arm the denial: `portalops db psql --env local -- -c "UPDATE tiers SET agent_turns_per_min = 1 WHERE slug = 'standard'"` (dev org is on `standard`)
- [ ] In a portal session, send "hello" → normal turn (answer streams)
- [ ] Within the same minute, send "hello again" → **no answer starts**; an inline **warning notice** appears ("You're sending messages too quickly. Try again in a moment.") with the **View plans** upgrade link; the composer stays enabled; the optimistic bubble is rolled back
- [ ] DB truth: `portal_messages` for this portal gained exactly **one** user row from the two sends (`portalops db psql --env local`)
- [ ] Network truth: the second POST returned **429**, body `code: AGENT_TURN_LIMITED`, `Retry-After` header ≤ 60 (browser devtools or the walk's network capture)
- [ ] Wait ~60s → send again → normal turn (the window rolled; the notice cleared)
- [ ] Restore: `UPDATE tiers SET agent_turns_per_min = 3 WHERE slug = 'standard'` (the catalog value)

## §3 — Tier-data surfaces (AC2 null-skip, AC4)

- [ ] Settings → Subscription & Billing: the three self-serve plan cards show an **"Agent turns"** row (`3/min · 9/day`, `5/min · 13/day`, `10/min · 26/day`). (The Enterprise card is a bespoke contact card with no allocation grid — pre-existing design, nothing to assert there.)
- [ ] An unlimited tier never touches the gate: set the dev org's tier to a row with both columns NULL (or use `enterprise`) → sends are unthrottled and API logs show no `agent-turn-ceiling` lines — manual (log glance)
- [ ] `curl localhost:3001/api/public/site-config` → payload **unchanged** (no turn fields; the strict contract withholds policy internals)
- [ ] Help → FAQ shows "Is there a limit on how many messages I can send?"; glossary "Subscription Plan" mentions the send ceiling

## §4 — Failure edge (AC3) — manual, optional

- [ ] With a 1/min tier armed, `docker stop portalai-redis-1` → a send **succeeds** (fail-open) and the API log warns `agent-turn admission unavailable; failing open` → `docker start portalai-redis-1`. (Skipping is acceptable — the fail-open paths are unit-pinned; note the reason if skipped.)

## §5 — Rollout (post-merge)

- [ ] Merge #503 → deploy-dev auto-runs (migration 0090 applies) → `portalops tier apply --env app-dev --yes` converges the four ceilings; spot-check one denial on app-dev with a temporary 1/min value, then re-apply the catalog
- [ ] Prod: next release deploys the migration → `portalops tier apply --env prod --yes --confirm-prod` → prod tier rows carry 3/9, 5/13, 10/26, null (psql read-back)
- [ ] Post-apply, prod `site-config` still 200 and byte-compatible (no new fields)

## §6 — Close-out (AC7)

- [ ] The SSE reconnect re-fire (`portal-events.router.ts:118` — a reconnect re-invokes the Anthropic call; pre-existing leak the POST gate does not cover) is filed as its own Bug with the #498 evidence

## Sign-off

- [ ] Every section above verified (or its skip reason named inline)
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/portal/tier ids):
