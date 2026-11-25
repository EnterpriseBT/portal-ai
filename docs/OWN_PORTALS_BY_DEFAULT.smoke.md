# own-portals-by-default — Smoke Suite

Manual smoke test for [#1127](https://github.com/EnterpriseBT/portal-ai/issues/1127): owners and admins see only their own portals by default, explicit portal grants still give access, and the follow-ups from review (pins, member removal, station delete copy, Help). **Branch under test:** `fix/1127-own-portals-by-default` (PR [#1129](https://github.com/EnterpriseBT/portal-ai/pull/1129)).

## Preflight

### Environment

- [ ] `git checkout fix/1127-own-portals-by-default && git pull --ff-only`
- [ ] `npm install`, then `npm run build` (core changed; no migration, no seed change).
- [ ] `npm run dev` boots cleanly (web :3000, API :3001). If the API was already running, restart it (touch `apps/api/src/app.ts`): nodemon doesn't watch core's build.

### Fixtures

- [ ] The seeded `e2e-fixture` org with its three identities: owner (E2E Test User), admin (`e2e-admin@portalsai.io`) and member (`e2e-member@portalsai.io`). Switch with `npm run --workspace @portalai/e2e e2e:use <owner|admin|member>`, then reopen the browser.
- [ ] The org is entitled to custom RBAC (Settings → Access shows policy authoring).
- [ ] A station the member can open (their own "Member Lab"), which the owner and admin can also read.

### Reset between runs

- [ ] Delete the walk's portals, the "Portal readers" policy and the walk's pin. Nothing else changes.

## §1 — Owners see only their own portals

- [ ] As the **member**, open Member Lab and start a portal. Rename it "Member private (smoke)" and send "hello".
- [ ] As the **owner**, open the dashboard: Recent portals doesn't list "Member private (smoke)".
- [ ] As the owner, open Member Lab's page: its Portals list doesn't include "Member private (smoke)". The owner's own portals there still show.
- [ ] As the owner, open the member's portal by its URL (`/portals/<id>`, copied from the member's address bar): the page says the portal isn't found. Nothing is written to it (checked as the member: still one message).

## §2 — Admins see only their own portals

- [ ] As the **admin**, repeat §1's three checks: the dashboard, Member Lab's Portals, and the URL. All three show only the admin's own portals, and the URL is not found.

## §3 — An explicit grant still gives access

- [ ] As the **owner**, open Settings → Access and create a custom policy "Portal readers" with one statement: allow, `read`, `portal`, all portals, no condition. Saving succeeds, with no "exceeds your access" error. Attach it to the admin user.
- [ ] As the **admin**, reload. The dashboard's Recent portals and Member Lab's Portals now list "Member private (smoke)", and it opens.
- [ ] In it, as the admin, sending a message isn't possible: the composer is read-only, or a send is refused. Reading only grants read.
- [ ] As the owner, remove the policy. As the admin, after a reload, the portal is gone from the lists again and its URL is not found.

## §4 — A shared pin doesn't lead to a dead portal link

- [ ] As the **member**, in "Member private (smoke)", ask a question that returns a table or chart. Pin the result as "Member pin (smoke)" and share it with the owner (read).
- [ ] As the **owner**, open the pin from Pinned Results: it renders, and its actions menu has **no** "Open Source Portal".
- [ ] As the **member**, open the same pin: "Open Source Portal" is there and opens their portal.

## §5 — Removing a member removes their portals — manual

- [ ] **Destructive: don't remove the fixture member.** Invite a throwaway user to the org, sign in as them and start a portal, then pin and share one result with the owner. As the owner, remove that member (Settings → Members). That member's portal is gone (`db:studio` → `portals`: `deleted` is set; `portal_messages` for it are gone). The shared pin still opens for the owner, with no "Open Source Portal". The integration test `portal.router.authorization.integration.test.ts` covers the same path.

## §6 — Station delete says it deletes others' portals

- [ ] As the owner, open a station's Delete dialog and don't confirm. Its warning reads: "All of this station's portals, including other people's that you can't see, their messages, and unpinned results will be permanently deleted. Pinned results will be preserved." Cancel.

## §7 — Help

- [ ] Help → Glossary → "Portal": the entry ends with "A portal is private to the person who started it: anyone else sees it only if they've been granted access to portals."
- [ ] In Help, search "portal not found": the troubleshooting entry "A portal link says “Portal not found”" comes first, with its cause (portals are private, deleted, or the creator left) and fix (ask for a shared pin, or for access to portals).

## §8 — Unchanged behaviour

- [ ] As the member, Recent portals lists only the member's portals, as before.
- [ ] As the owner, other objects are unchanged: Stations, Views, Connectors and Pinned Results list what they did before this branch, the member's shared items included.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/portal/pin/policy ids):
