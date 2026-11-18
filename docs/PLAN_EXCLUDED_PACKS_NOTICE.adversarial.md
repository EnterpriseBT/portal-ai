# PLAN_EXCLUDED_PACKS_NOTICE — Adversarial Review

Adversarial probes for [#1055](https://github.com/EnterpriseBT/portal-ai/issues/1055): the station notice names plan-excluded packs and links to plans. **Branch under test:** `fix/1055-plan-excluded-packs-notice` (PR [#1069](https://github.com/EnterpriseBT/portal-ai/pull/1069)).

## Preflight

### Environment
- [ ] Same as the smoke checklist: branch checked out, core built, `npm run dev` running.

### Fixtures
- [ ] e2e-fixture org (`f01f20fe…`), starting on its original tier (enterprise).
- [ ] Create **Adv GIS** (GIS, Curated Views, Sandbox, no views) on enterprise.
- [ ] Create **Adv Custom** (one custom pack, Curated Views, Sandbox) on enterprise.
- [ ] Create **Adv Four+Custom** (GIS, Statistics, Visualize, Regression, one custom pack, Curated Views, Sandbox) on enterprise.
- [ ] Then `npx portalai org set-tier <orgId> standard --env local --yes` and restart the API (tier cache).

### Reset between runs
- [ ] `set-tier` back to the original tier, restore anything soft-deleted, and delete the Adv stations.

## §1 — Boundary & limit inputs

- [ ] Open **Adv Four+Custom** on standard. Four built-ins and a custom pack are excluded. The list is cut, but the organization's packs stay named: "GIS, Statistics, your organization's tool packs and 2 more aren't included in your plan, …" (the first two built-ins in the station's chip order). It's one sentence with no double "and", and the custom packs aren't folded into the count.
- [ ] Remove every tool pack from **Adv GIS** except Curated Views (Edit Station) on standard. No pack reads data, so the notice falls back to today's counts text, with no plan sentence and no View plans.

## §2 — Auth & permission boundaries

- [ ] Switch to **e2e-member** (`npm run --workspace @portalai/e2e e2e:use -- member`, reopen the browser) and open a station the member can read whose only reading pack the plan excludes:
  - The notice is identical to the owner's; it names no role and makes no claim about the member's access.
  - **View plans** opens Settings → Subscription & Billing as a read-only plans view, with no checkout or plan change available to a caller without `billing.manage`.
  - Switch back to owner afterwards.

## §3 — State & lifecycle abuse

- [ ] **Downgrade under an open page.** With **Adv GIS** open while the org is on enterprise (notice: today's "No views are attached… Attach a view…"), run `set-tier … standard` and restart the API. Then trigger a refetch: wait 60s, then hide and show the tab, or reload. The notice and the GIS chip flip together to the plan sentence and "Not included in your plan". They never disagree.
- [ ] **Upgrade back.** On standard with the plan sentence showing, run `set-tier … enterprise` and refetch. The notice returns to today's "Attach a view" text, and the plan sentence and View plans link disappear.
- [ ] **Deleted custom pack (accepted divergence, discovery Q2).** On standard, soft-delete **Adv Custom**'s custom pack (`update organization_toolpacks set deleted = <now ms>, deleted_by = 'adv' where id = …`). Open Adv Custom:
  - The page still reads "Your organization's tool packs aren't included…" (the web sees the dangling `org:` ref).
  - Record the assistant's `platform_help` answer for the same station. It is expected to differ, and that's accepted and left for #1063.
  - Restore the row.
  - — backend

## §4 — Misuse sequences

- [ ] **Follow the old advice anyway.** On standard, attach a view to **Adv GIS** (Edit Station). The notice still names GIS and the plan; it doesn't disappear or imply data is now available. Ask the portal "Show me the data on this station". The assistant still says GIS isn't in the plan. — manual (the assistant's answer is read by a human)
- [ ] **Swap the excluded pack for one on the plan.** On standard, add **Data Query** to Adv GIS. The plan sentence disappears and the notice follows the counts again (or there's none once a view is attached), because a pack that reads data is now usable.

## §5–§7 — N/A

- **Malformed & injection input:** N/A. The notice renders built-in display names and a fixed custom-pack label, never user-typed text, and adds no input.
- **Multi-tenant isolation:** N/A. No new request; the state comes from the caller's own station and their own org's plan, both already loaded and authorized.
- **Concurrency & races:** N/A as a separate category. The only race is a plan change against an open page, probed in §3. The state is derived on render, with nothing to double-submit.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/station ids, tier):
