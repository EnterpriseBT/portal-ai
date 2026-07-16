# tier-toolpack-entitlements — Smoke Suite

Manual smoke test for [#214](https://github.com/EnterpriseBT/portal-ai/issues/214) — tier toolpack entitlements: a built-in allowlist + custom-toolpacks boolean on `tiers` rows (data-defined, no deploy), enforced at tool build (excluded packs never reach the agent) and at custom-toolpack registration (403), with non-destructive downgrade. **Branch under test:** `feat/tier-toolpack-entitlements` (PR into `epic/subscription-billing`).

**All sections verified 2026-07-16.** Walk-found bug (pre-existing, fixed on this branch): the mock toolpack server's three #124 reference tools lacked the now-required `capability.production` — registration failed `TOOLPACK_SCHEMA_INVALID` until fixed; plus `npm run mock-toolpack` → `npm run webhook:toolpack` doc drift. Run **§Preflight** once. §2 is a continuous story (register → entitle-off → inert → entitle-on → reactivated); §1, §3, §4, §5 are independent after preflight. "All tests pass / guard test fails a bypassing path" is the **CI half of the gate**, not a walkthrough step. Entitlement edits take effect within the tier cache's 60 s TTL — each `UPDATE` step says "wait ≤ 60 s (or restart the API)".

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [x] `git checkout feat/tier-toolpack-entitlements && git pull --ff-only`
- [x] `npm install && npm run build --workspace=packages/core` — `TierPolicy` gained `entitlements`; API + web need the rebuilt core dist.
- [x] `cd apps/api && npm run db:migrate && cd ../..` — migration `0069_add_tier_toolpack_entitlements.sql` adds the two columns and backfills **every existing tier row fully permissive**. Confirm it applies cleanly.
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`); Auth0 dev login works.
- [x] In a second terminal: `cd apps/api && npm run webhook:toolpack` — the reference toolpack server on `:4100` (the custom-pack fixture for §2).

### Fixtures

- [x] Your dev org is on `standard` (`db:studio` → `organizations.tier`, or Settings → Organization).
- [x] A station you can open a portal session on, with the **web_search** pack enabled (used in §3) — enable it on the station if absent.
- [x] `db:studio` → `tiers`: every row (standard + any scratch rows) shows `builtin_toolpacks` = all six slugs and `custom_toolpacks = true` — the §1 backfill probe.
- [x] Grab a bearer token for the curl steps: DevTools → Network → any `/api/` request → copy the `Authorization` header value.

### Reset between runs

- [x] Restore standard to permissive and re-point the org (idempotent):
  ```sql
  UPDATE tiers SET
    builtin_toolpacks = '["data_query","statistics","regression","financial","web_search","entity_management"]'::jsonb,
    custom_toolpacks = true
  WHERE slug = 'standard';
  UPDATE organizations SET tier='standard' WHERE id='<org id>';
  ```
  Delete the §2 test toolpack from the Toolpacks page if you want a clean slate (not required — §2 is re-runnable against an existing registration).

---

## §1 — Deploy-day zero change (backfill + inert data)

> Walked note: the prompts were exercised as the §2/§3 baselines (same assertions, same session shapes).

- [x] Post-migrate, with **no** entitlement edits: open a portal session and run a data prompt (e.g. **"how many records are in <your entity>?"**) and a web prompt (**"search the web for today's date"**) — both work exactly as before this branch.
- [x] The Toolpacks page shows no "Inactive on your plan" badge anywhere; **Register toolpack** is enabled.
- [x] `db:studio` → `tiers` → `standard`: `builtin_toolpacks` lists all six slugs, `custom_toolpacks = true` (the hand-added backfill, not the fail-closed column default).

## §2 — Custom-toolpack entitlement round-trip (the core story)

*Register while entitled:*

- [x] Toolpacks → **Register toolpack** → name `smoke_intel`, schema URL `http://localhost:4100/schema`, runtime URL `http://localhost:4100/runtime` → registers **201**, signing secret revealed, pack listed as Custom.
- [x] Attach `smoke_intel` to your test station (station settings → toolpacks).
- [x] In a portal session on that station, prompt a custom tool (walked with **"use the add_numbers tool to add 2 and 3"**) — the agent calls it; the mock server (run in signature-verifying mode with the revealed secret) logged the **HMAC-verified** runtime POST.

*Entitle off (no deploy):*

- [x] `UPDATE tiers SET custom_toolpacks = false WHERE slug = 'standard';` — wait ≤ 60 s or restart the API.
- [x] Toolpacks page (refresh): `smoke_intel` row shows the **"Inactive on your plan"** chip; **Register toolpack** is disabled with tooltip "Your plan does not include custom toolpacks".
- [x] New portal session, same prompt — the agent **does not have** `lookup_company` (it answers without the tool or says it lacks such a tool; no runtime POST hits the mock server).
- [x] Registration is server-blocked, not just hidden:
  ```bash
  curl -s -X POST http://localhost:3001/api/toolpacks \
    -H "Authorization: Bearer <token>" -H 'content-type: application/json' \
    -d '{"name":"blocked_pack","endpoints":{"schema":"http://localhost:4100/schema","runtime":"http://localhost:4100/runtime"}}'
  ```
  → **403** `TOOLPACK_NOT_ENTITLED`; `db:studio` → `organization_toolpacks` has no `blocked_pack` row.
- [x] **Non-destructive**: `organization_toolpacks` still holds `smoke_intel` (deleted IS NULL, unchanged) and `station_toolpacks` still holds its attachment row — nothing was deleted or rewritten.
- [x] **Management stays open (OQ3)**: on the inert `smoke_intel` row, Edit (change the description) and Refresh both succeed.

*Entitle back on:*

- [x] `UPDATE tiers SET custom_toolpacks = true WHERE slug = 'standard';` — wait ≤ 60 s or restart the API.
- [x] Toolpacks page: chip gone, Register enabled. New portal session, same prompt — `lookup_company` works again **with zero re-setup** (same registration, same station attachment).

## §3 — Built-in allowlist subtraction

- [x] Baseline: portal prompt **"search the web for the weather in Denver"** — the agent uses `web_search`.
- [x] Remove the pack from standard's allowlist:
  ```sql
  UPDATE tiers SET builtin_toolpacks =
    '["data_query","statistics","regression","financial","entity_management"]'::jsonb
  WHERE slug = 'standard';
  ```
  Wait ≤ 60 s or restart the API.
- [x] New portal session, same prompt — the agent has **no web_search tool** (station still has the pack enabled; the tier filtered it). Data-query prompts still work (only the removed pack is gone).
- [x] **Other tiers unaffected**: `db:studio` → point your org at the still-permissive scratch tier (`UPDATE organizations SET tier='pro-smoke' WHERE id='<org id>';`), new session → `web_search` works. Point back to `standard`.
- [x] Restore standard's full allowlist (Reset SQL above).

## §4 — Operator edits survive re-seeds (OQ1) + the unlisted-slug warn

- [x] Tighten standard: `UPDATE tiers SET builtin_toolpacks = '["web_search"]'::jsonb, custom_toolpacks = false, selectable = false WHERE slug='standard';`
- [x] `cd apps/api && npm run db:seed`
- [x] For the **`[seed]` warn** (OQ2 interim): the warn fires only when a slug is listed by **no live tier row** — with permissive scratch tiers around, tighten *all* rows first (`UPDATE tiers SET builtin_toolpacks = '["web_search"]'::jsonb;`), re-run `db:seed`, and expect the warn naming the five unlisted slugs. Restore all rows afterwards.
- [x] `db:studio` → `tiers` → `standard`: `builtin_toolpacks` still `["web_search"]` and `custom_toolpacks` still `false` (operator-authoritative — the seed did **not** revert them), while `selectable` healed back to `true` (seed-authoritative).
- [x] Restore standard (Reset SQL above); re-run `npm run db:seed` → no warn.

## §5 — Error & edge cases

- [x] **Fully-filtered station is not an error**: with standard's allowlist set to `'[]'::jsonb` (and `custom_toolpacks=false`), open a portal session — it starts cleanly; the agent still answers time/context questions (system tools: **"what time is it?"**) but has no pack tools. Restore afterwards.
- [x] **Unknown allowlist slug is inert**: `UPDATE tiers SET builtin_toolpacks = '["data_query","future_pack"]'::jsonb WHERE slug='standard';` → new session: data-query tools work; the API log shows a `warn` about `future_pack` being unknown to the registry. Restore.
- [x] **Help surface**: Help → FAQ shows "Why is a toolpack marked 'Inactive on your plan'?" with the non-destructive explanation.
- [x] *(CI-half, not manually smokeable: the #184-sibling guard — a tool-construction path bypassing the filter fails `tools.service.test.ts`; the migration probe + OQ1 pin run in the integration suite.)*

## Sign-off

- [x] Every section above verified
- [x] 2026-07-16 — Ben Turner (@bbgrabbag) — confirmed against my own running stack (browser flows walked by me; SQL/curl/DB probes + seed runs driven via Claude Code in the shared devcontainer; mock server monitored live)

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/tier slug/toolpack ids):
