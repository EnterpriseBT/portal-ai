# tier-toolpack-entitlements — Smoke Suite

Manual smoke test for [#214](https://github.com/EnterpriseBT/portal-ai/issues/214) — tier toolpack entitlements: a built-in allowlist + custom-toolpacks boolean on `tiers` rows (data-defined, no deploy), enforced at tool build (excluded packs never reach the agent) and at custom-toolpack registration (403), with non-destructive downgrade. **Branch under test:** `feat/tier-toolpack-entitlements` (PR into `epic/subscription-billing`).

Run **§Preflight** once. §2 is a continuous story (register → entitle-off → inert → entitle-on → reactivated); §1, §3, §4, §5 are independent after preflight. "All tests pass / guard test fails a bypassing path" is the **CI half of the gate**, not a walkthrough step. Entitlement edits take effect within the tier cache's 60 s TTL — each `UPDATE` step says "wait ≤ 60 s (or restart the API)".

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/tier-toolpack-entitlements && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — `TierPolicy` gained `entitlements`; API + web need the rebuilt core dist.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — migration `0069_add_tier_toolpack_entitlements.sql` adds the two columns and backfills **every existing tier row fully permissive**. Confirm it applies cleanly.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); Auth0 dev login works.
- [ ] In a second terminal: `cd apps/api && npm run mock-toolpack` — the reference toolpack server on `:4100` (the custom-pack fixture for §2).

### Fixtures

- [ ] Your dev org is on `standard` (`db:studio` → `organizations.tier`, or Settings → Organization).
- [ ] A station you can open a portal session on, with the **web_search** pack enabled (used in §3) — enable it on the station if absent.
- [ ] `db:studio` → `tiers`: every row (standard + any scratch rows) shows `builtin_toolpacks` = all six slugs and `custom_toolpacks = true` — the §1 backfill probe.
- [ ] Grab a bearer token for the curl steps: DevTools → Network → any `/api/` request → copy the `Authorization` header value.

### Reset between runs

- [ ] Restore standard to permissive and re-point the org (idempotent):
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

- [ ] Post-migrate, with **no** entitlement edits: open a portal session and run a data prompt (e.g. **"how many records are in <your entity>?"**) and a web prompt (**"search the web for today's date"**) — both work exactly as before this branch.
- [ ] The Toolpacks page shows no "Inactive on your plan" badge anywhere; **Register toolpack** is enabled.
- [ ] `db:studio` → `tiers` → `standard`: `builtin_toolpacks` lists all six slugs, `custom_toolpacks = true` (the hand-added backfill, not the fail-closed column default).

## §2 — Custom-toolpack entitlement round-trip (the core story)

*Register while entitled:*

- [ ] Toolpacks → **Register toolpack** → name `smoke_intel`, schema URL `http://localhost:4100/schema`, runtime URL `http://localhost:4100/runtime` → registers **201**, signing secret revealed, pack listed as Custom.
- [ ] Attach `smoke_intel` to your test station (station settings → toolpacks).
- [ ] In a portal session on that station, prompt: **"use the lookup_company tool on example.com"** — the agent calls the custom tool (tool-call panel shows it; the mock server terminal logs the runtime POST).

*Entitle off (no deploy):*

- [ ] `UPDATE tiers SET custom_toolpacks = false WHERE slug = 'standard';` — wait ≤ 60 s or restart the API.
- [ ] Toolpacks page (refresh): `smoke_intel` row shows the **"Inactive on your plan"** chip; **Register toolpack** is disabled with tooltip "Your plan does not include custom toolpacks".
- [ ] New portal session, same prompt — the agent **does not have** `lookup_company` (it answers without the tool or says it lacks such a tool; no runtime POST hits the mock server).
- [ ] Registration is server-blocked, not just hidden:
  ```bash
  curl -s -X POST http://localhost:3001/api/toolpacks \
    -H "Authorization: Bearer <token>" -H 'content-type: application/json' \
    -d '{"name":"blocked_pack","endpoints":{"schema":"http://localhost:4100/schema","runtime":"http://localhost:4100/runtime"}}'
  ```
  → **403** `TOOLPACK_NOT_ENTITLED`; `db:studio` → `organization_toolpacks` has no `blocked_pack` row.
- [ ] **Non-destructive**: `organization_toolpacks` still holds `smoke_intel` (deleted IS NULL, unchanged) and `station_toolpacks` still holds its attachment row — nothing was deleted or rewritten.
- [ ] **Management stays open (OQ3)**: on the inert `smoke_intel` row, Edit (change the description) and Refresh both succeed.

*Entitle back on:*

- [ ] `UPDATE tiers SET custom_toolpacks = true WHERE slug = 'standard';` — wait ≤ 60 s or restart the API.
- [ ] Toolpacks page: chip gone, Register enabled. New portal session, same prompt — `lookup_company` works again **with zero re-setup** (same registration, same station attachment).

## §3 — Built-in allowlist subtraction

- [ ] Baseline: portal prompt **"search the web for the weather in Denver"** — the agent uses `web_search`.
- [ ] Remove the pack from standard's allowlist:
  ```sql
  UPDATE tiers SET builtin_toolpacks =
    '["data_query","statistics","regression","financial","entity_management"]'::jsonb
  WHERE slug = 'standard';
  ```
  Wait ≤ 60 s or restart the API.
- [ ] New portal session, same prompt — the agent has **no web_search tool** (station still has the pack enabled; the tier filtered it). Data-query prompts still work (only the removed pack is gone).
- [ ] **Other tiers unaffected**: `db:studio` → point your org at the still-permissive scratch tier (`UPDATE organizations SET tier='pro-smoke' WHERE id='<org id>';`), new session → `web_search` works. Point back to `standard`.
- [ ] Restore standard's full allowlist (Reset SQL above).

## §4 — Operator edits survive re-seeds (OQ1) + the unlisted-slug warn

- [ ] Tighten standard: `UPDATE tiers SET builtin_toolpacks = '["web_search"]'::jsonb, custom_toolpacks = false, selectable = false WHERE slug='standard';`
- [ ] `cd apps/api && npm run db:seed`
- [ ] The seed output prints the **`[seed]` warn** naming the five slugs no tier row lists (OQ2 interim).
- [ ] `db:studio` → `tiers` → `standard`: `builtin_toolpacks` still `["web_search"]` and `custom_toolpacks` still `false` (operator-authoritative — the seed did **not** revert them), while `selectable` healed back to `true` (seed-authoritative).
- [ ] Restore standard (Reset SQL above); re-run `npm run db:seed` → no warn.

## §5 — Error & edge cases

- [ ] **Fully-filtered station is not an error**: with standard's allowlist set to `'[]'::jsonb` (and `custom_toolpacks=false`), open a portal session — it starts cleanly; the agent still answers time/context questions (system tools: **"what time is it?"**) but has no pack tools. Restore afterwards.
- [ ] **Unknown allowlist slug is inert**: `UPDATE tiers SET builtin_toolpacks = '["data_query","future_pack"]'::jsonb WHERE slug='standard';` → new session: data-query tools work; the API log shows a `warn` about `future_pack` being unknown to the registry. Restore.
- [ ] **Help surface**: Help → FAQ shows "Why is a toolpack marked 'Inactive on your plan'?" with the non-destructive explanation.
- [ ] *(CI-half, not manually smokeable: the #184-sibling guard — a tool-construction path bypassing the filter fails `tools.service.test.ts`; the migration probe + OQ1 pin run in the integration suite.)*

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/tier slug/toolpack ids):
