# own-portals-by-default — Adversarial Review

Adversarial probes for [#1127](https://github.com/EnterpriseBT/portal-ai/issues/1127): a wildcard allow covers a portal only for its creator (or a system-created one), while explicit portal grants and authoring keep working. **Branch under test:** `fix/1127-own-portals-by-default` (PR [#1129](https://github.com/EnterpriseBT/portal-ai/pull/1129)).

## Preflight

### Environment

- [ ] Same as the smoke doc: branch checked out, `npm run build`, `npm run dev` (web :3000, API :3001), the API restarted after the core build.

### Fixtures

- [ ] The `e2e-fixture` org (owner, admin, member), switched with `npm run --workspace @portalai/e2e e2e:use <role>`.
- [ ] A member portal "Member private (adv)" in Member Lab with one message, and its id (`<P>`). For the backend probes, a bearer token per role (from the browser's network panel or the e2e storage state).
- [ ] A second org the owner doesn't belong to, with a portal in it (`<Q>`), for §5.

### Reset between runs

- [ ] Delete the walk's portals, policies, grants and pins.

## §1 — Boundary & limit inputs — N/A

The change adds no input, field or limit; the routes' inputs are unchanged.

## §2 — Malformed & injection input — N/A

No new parsing or query construction from input: the new SQL predicate binds the caller's id and the system id, both server-side.

## §3 — Concurrency & races

- [ ] As the admin with a read-only "Portal readers" grant, open "Member private (adv)" while the member sends a message in it. — The admin sees the stream replay but never takes the turn lock: the member's turn finishes normally, and no second turn starts from the admin's tab.
- [ ] Remove the "Portal readers" policy while the admin has the portal open, then send from the admin's tab (if the composer allows) or reload. — The next request is refused (404); nothing is written to the portal. — manual (timing)

## §4 — Auth & permission boundaries

- [ ] As the owner, `GET /api/portals/<P>`, `PATCH /api/portals/<P>` `{"name":"x"}`, `DELETE /api/portals/<P>`, `POST /api/portals/<P>/messages`, and `GET /api/sse/portals/<P>/events`. — Every one answers 404 `PORTAL_NOT_FOUND`-shaped, nothing changes (the member still sees the name and one message). — backend
- [ ] Same five requests as the admin. — Same: 404 and nothing written. — backend
- [ ] As the owner, `GET /api/portals?stationId=<Member Lab>` and `GET /api/portals?mine=false`. — Only the owner's own portals; `<P>` isn't in any page. — backend
- [ ] As the owner, `POST /api/portal-results` pinning a block from `<P>` (`portalId: <P>`). — 404; no pin is created. — backend
- [ ] As the owner, read a map tile or SQL result handle that `<P>`'s messages reference (copy the URL as the member). — Refused (404/403); no rows returned. — backend
- [ ] As the **member**, create a custom policy with `allow * portal` (Settings → Access, or `POST /api/policies`). — Refused as exceeding their access (or the authoring UI isn't offered); no policy exists afterwards.
- [ ] As the admin, create a policy `allow * *` and attach it to themself; then open `/portals/<P>`. — Still not found: a wildcard doesn't reach others' portals, even newly authored.
- [ ] As the owner, author a policy granting `read portal:<P>` (instance) to the admin. — Allowed; the admin can read `<P>` and nothing else of the member's (a second member portal stays 404).
- [ ] As the admin with only `read portal`, `PATCH`/`DELETE` `<P>` and `POST` a message. — 403; nothing changes. — backend
- [ ] As the owner, add a deny `deny read portal` to the admin alongside "Portal readers". — Deny wins: `<P>` and the admin's **own** portals are 404 for the admin.

## §5 — Multi-tenant isolation

- [ ] As the owner, `GET /api/portals/<Q>` (the other org's portal), and the same with an `allow read portal` grant in the fixture org. — 404 both times; a grant in one org never reaches another org's portal. — backend
- [ ] As the owner, `GET /api/portal-results/<pin from Q's org>`. — 404, no `portalReadable` leaked. — backend

## §6 — State & lifecycle abuse

- [ ] Remove a throwaway member who owns a portal and a pin shared with the owner, then as the owner open the pin and `GET /api/portal-results/<pin>`. — The pin renders, `portalId` is null, `portalReadable` is false, no "Open Source Portal". — manual (destructive)
- [ ] Re-invite the same throwaway user and sign in as them. — Their old portal isn't back (it stays soft-deleted); Recent portals is empty. — manual
- [ ] As the member, delete "Member private (adv)", then as an admin holding "Portal readers" open its URL. — 404; the deleted portal isn't listed.
- [ ] A system-created portal (seeded demo, if present): as the owner and as the member, open it. — Both can read it, as before this branch (own-or-system).

## §7 — Misuse sequences

- [ ] As the member, share a pin from `<P>` with the owner, then copy "Open Source Portal"'s URL as the member and paste it as the owner. — Not found; the pin itself still opens for the owner.
- [ ] As the owner, delete Member Lab. — The dialog warns that others' portals you can't see will be deleted; after confirming, the member's `<P>` is gone too (expected cascade) and their pins survive with no source link.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/portal/pin/policy ids):
