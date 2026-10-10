# DIALOG_DOUBLE_SUBMIT — Smoke Suite

Manual smoke test for [#751](https://github.com/EnterpriseBT/portal-ai/issues/751): one request per submit intent. `useAuthMutation` drops a duplicate in-flight request, `useSingleFlight` stops a duplicate workflow run, and #747's Modal hold and the repeat-click swallow are gone. **Branch under test:** `fix/751-dialog-double-submit` (PR [#752](https://github.com/EnterpriseBT/portal-ai/pull/752)).

Every step is watched in **DevTools → Network** (filter `/api/`). "One request" means one row for that method and URL. Steps tagged `— manual` need a human. The rest are `/smoke-walk`-eligible.

## Preflight

### Environment

- [ ] `git checkout fix/751-dialog-double-submit && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core` (core's `Modal` changed; web reads core's `dist`). No migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] Signed in as the e2e owner in the `e2e-fixture` org (`npm run --workspace @portalai/e2e e2e:auth`; `e2e:seed` if the org is missing). The org has "My Station" and the e2e admin and member users.
- [ ] For §3: "My Station" shared with **two** people (Share → add the e2e admin and the e2e member, each with Read), so two grants exist to revoke.
- [ ] For §4: a small CSV to hand. The sample under **Connectors → File upload → Sample files** works.

### Reset between runs

- [ ] Delete any station named `SMOKE751…` and any connector created in §4. Re-share My Station for §3 if you already revoked both grants.

## §1 — Dialog submits send once (slice 1, slice 3)

- [ ] **Stations → New Station**, name `SMOKE751 dbl`, **double-click Create** → one `POST /api/stations`, and exactly one `SMOKE751 dbl` row in the list afterwards.
- [ ] **New Station**, name `SMOKE751 enter`, press **Enter twice fast** in the Name field → one `POST /api/stations`; one new row.
- [ ] **New Station**, name `SMOKE751 mix`, **click Create and immediately press Enter** → one `POST /api/stations`; one new row.
- [ ] **Edit Field Mapping** on any field mapping (an entity's Fields tab → Edit), change **Normalized Key** → **Save** → the re-validation warning appears → **double-click Confirm & Save** → one `PATCH /api/field-mappings/<id>`.
- [ ] **Delete** one of the `SMOKE751` stations from its row → in the confirm dialog, **double-click Delete** → one `DELETE /api/stations/<id>`, and no error toast from a second call on a row that's already gone.
- [ ] **Entity Groups → Create Group** (a raw `Dialog`; its swallow was removed): name `SMOKE751 group`, **double-click Create** → one `POST /api/entity-groups`. Delete the group afterwards.

## §2 — Nothing legitimate is blocked (slice 3)

- [ ] **New Station**, leave Name empty, click **Create** → the Name error shows. Type `SMOKE751 retry` and **press Enter within half a second** → the `POST /api/stations` goes out at once. The old 500 ms hold would have swallowed it.
- [ ] **Connectors → New → REST API**, fill Basics and move on to step 3 → click **Back**, wait a beat, click **Back** again → back at step 1. Neither click is swallowed. (Two clicks inside one render both go back from the same step; that predates #751.)
- [ ] Clicking **Cancel** once in any of the dialogs above closes it.

## §3 — Different requests still run in parallel (slice 1)

- [ ] **My Station → Share**: with two grants listed, click **revoke on both, quickly, one after the other** → **two** `DELETE` requests to different grant URLs, and both people are gone from the list.

## §4 — Workflow runs once (slice 2)

- [ ] **File upload** connector: add the sample CSV, **double-click Upload** → one upload, and one parse progress bar run (not two interleaved).
- [ ] Draw a region, **double-click Interpret** → one interpret request; the review step appears once.
- [ ] **Double-click Commit plan** → one commit request, and exactly **one** new connector instance in **Connectors**. Delete it afterwards.
- [ ] **REST API** connector: fill Basics, one endpoint and its columns, then **double-click Commit** → one `POST` creating the instance, then one `POST` per endpoint (not two of each). Exactly one new instance in **Connectors**. Delete it afterwards. — manual (needs a reachable test API for the endpoint probe)

## §5 — Page-level actions get it for free

- [ ] On a connector instance with a sync, **double-click Sync now** → one sync request, and one running sync in the lock alert.

## §6 — Error & edge cases

- [ ] **New Station** with the network offline (DevTools → Offline), click **Create** → the dialog's error shows. Go back online and click **Create** again → it sends. A failed request frees the guard.
- [ ] **`swallowRepeatClick` is gone:** `grep -rn swallowRepeatClick apps packages --include=*.ts --include=*.tsx` (excluding `node_modules`/`dist`) prints nothing. — backend

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/connector/field-mapping ids):

---

Acceptance criteria → steps (spec `## Acceptance criteria`):

| Criterion | Steps |
|---|---|
| Double-click, double Enter, click then Enter, double Confirm & Save → one request | §1 |
| Two different requests from one hook both send | §3 |
| Workflow Upload, Interpret and Commit start one run | §4 |
| A corrected resubmit after a validation error sends immediately | §2 step 1 |
| Back twice steps back twice | §2 step 2 |
| No Modal hold or swallow; `swallowRepeatClick` is gone | §1 last step, §6 step 2 |
