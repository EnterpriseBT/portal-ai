# dashboard-start-box — Smoke Suite

Manual smoke test for [#1079](https://github.com/EnterpriseBT/portal-ai/issues/1079): the dashboard's start box. Type a question, pick a station, press Enter, and land in a new portal that's already answering it. A question refused by the agent-turn limit still creates the portal and waits in its composer. **Branch under test:** `feat/1079-dashboard-start-box` (PR [#1137](https://github.com/EnterpriseBT/portal-ai/pull/1137), into `epic/dashboard-redesign`).

Run **§Preflight** once. Each section after it is independent. Steps tagged `— manual` need a human; `— backend` steps are API, Redis or DB checks outside the browser. Every other step is walkable by `/smoke-walk`.

**Turn budget.** `e2e:seed` puts `e2e-fixture` on the **standard** tier: **9 agent turns a day per org**. §1 spends 2, §2 spends 1 and §4 spends 1; §4 forces its refusal through Redis. If the org is already near its limit, clear the day counter first (§Reset). An org on a tier with no turn limit (enterprise) can't be refused: switch it to standard for §4 and §5 (`update organizations set tier = 'standard' where id = '<orgId>';`).

---

## Preflight

### Environment

- [ ] `git checkout feat/1079-dashboard-start-box && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core`. Core changed: the message limit and start/outcome contracts, `Composer`'s `error`/`onBlur`, and `Icon`'s yellow star. **Restart the API dev server** after the build, because nodemon doesn't watch core. No migration and no seed.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).
- [ ] Signed in as the e2e owner (`npm run --workspace @portalai/e2e e2e:auth` if the session expired). Login lands on the dashboard at `/`.

### Fixtures

- [ ] The `e2e-fixture` org (`npm run --workspace @portalai/e2e e2e:seed`) with at least these stations:
  - **Playground**, provisioned with every org since #848 (has data and the `data_query` pack). `e2e:seed` reuses an existing org by name, so an `e2e-fixture` org seeded before 2026-11-17 has no Playground (it has the old **My Station**). Delete it (`npx portalai org delete <orgId> --env local --yes`) and re-seed;
  - **one favorite station** (star it from Stations);
  - **at least two other stations**, so the suggestions have something to group.
- [ ] At least one portal you opened earlier, so "Recent stations" has an entry. Open any portal once if there's none.
- [ ] Note the org id (`db:studio` → `organizations`, the row named `e2e-fixture`). §4, §5 and §Reset need it.
- [ ] Redis runs in the container `portalai-redis-1` (there's no compose service named `redis`), so the Redis commands below use `docker exec portalai-redis-1`.

### Reset between runs

- [ ] Clear the turn-limit counters (`— backend`):
  `docker exec portalai-redis-1 redis-cli --scan --pattern 'usage:rate:agent-turns:<orgId>:*' | xargs -r -n1 docker exec portalai-redis-1 redis-cli DEL`
- [ ] Portals created during the walk can stay, or delete them from Recent portals' row Delete.

---

## §1 — Start a portal from the dashboard (slices 2, 4 and 5)

- [ ] On the dashboard (`/`), the page's one `h1` is "Dashboard", and directly under it is a form named "Start a portal" with the field "Ask a question" (placeholder "Ask anything about your data…"), a station chip and Start.
- [ ] The dashboard has **no Open Portal button of its own** in its header, and no Open Portal dialog. The app header's Open Portal split button is still there.
- [ ] The chip is preselected with the station of your most recently opened portal. Its accessible name is "<station>, station. Change station".
- [ ] With the field empty, Start is `aria-disabled` and described "Type a question to start".
- [ ] Pick **Playground** in the chip. Type **"How many records are in this station?"** and press **Enter** (1 turn).
- [ ] You land on `/portals/<id>`. The question is the first message (right-aligned, as the caller's). The typing indicator appears, then the assistant streams an answer, without you pressing anything else.
- [ ] Recent portals on the dashboard lists the new portal first, with "Playground" as its station.
- [ ] Shift+Enter in the box adds a new line rather than starting.
- [ ] Back on the dashboard, start another question with the **Start button** instead of Enter: **"List the views in this station."** (1 turn). It lands in a new portal and answers.
- [ ] `— backend` In `db:studio` → `portal_messages` for the first new portal: exactly one `user` row, `blocks` = `[{"type":"text","content":"How many records are in this station?"}]` (trimmed), `created_by` = your user id, then one `assistant` row.

## §2 — The station chip: suggestions and search (slice 4, pre-smoke additions)

- [ ] Open the chip. A dialog named **"Pick a station"** opens, with a **"Search stations"** combobox focused at the top. The chip announces `aria-haspopup="dialog"`.
- [ ] With the search empty, up to **five** stations are listed under up to three headings, in this order:
  - **"Recent stations"**: the stations of your latest portals, newest first;
  - **"Favorite stations"**: your starred stations not already listed;
  - **"More stations"**: the org's newest stations, filling up to five.

  Each station appears once.
- [ ] A favorite's star is the **brand yellow**, in this list and elsewhere: the header's Open Portal menu, the sidebar's Favorites, a station page's favorite toggle and the favorites filter chip. An unstarred outline stays grey. `— manual` for the visual judgment.
- [ ] The search field and the options sit **inset from the popup's edges** (16px), as in the header's Open Portal menu. `— manual`
- [ ] Type the first few letters of a station that isn't suggested. After a short pause the list shows only matching stations, ungrouped (or "Searching…", then the matches). A query that matches nothing shows "No stations match".
- [ ] Pick a station found by search. The chip shows its name, and the popup closes. Reopen the chip: the search is empty, the suggestions are back, and the picked station is listed last under **"Selected station"** (when it isn't already suggested).
- [ ] Press Escape in the popup: it closes and focus returns to the chip.
- [ ] Settings → Billing: the "Subscription Tier" line uses a layers icon, not a star.
- [ ] `— backend` Unreadable stations are never suggested. As the e2e **member** (`e2e:use member`), have a portal of your own on a station you can no longer read: create a portal on a station shared with you, then remove the share. On the dashboard:
  - Recent portals lists that portal **without** a station name;
  - the chip's "Recent stations" doesn't list that station.

  `GET /api/portals?include=station` returns that portal with `"stationName": null`.
- [ ] Start a portal in the searched station with **"What can you help me with in this station?"** (1 turn). It lands and answers.

## §3 — Validation (slices 1 and 4)

- [ ] Paste a question of **20,001 characters** into the box (in the browser console: `copy("a".repeat(20001))`, then paste). No error shows while typing.
- [ ] Tab out of the field. "Question must be 20000 characters or fewer" appears under it, and the field is `aria-invalid="true"`.
- [ ] Press Start. Nothing is sent: no navigation, and no `POST /api/portals` in the network panel. Focus is in the field, and the pasted text is still all there, not cut.
- [ ] Delete text until it fits. The error clears.
- [ ] `— backend` `POST /api/portals` with `{"stationId":"<id>","initialMessage":"   "}` → `400 PORTAL_INVALID_PAYLOAD`, message naming `initialMessage`. With a 20,001-character `initialMessage` → the same 400, and no portal row is written (`db:studio` → `portals` count unchanged). Use Swagger "Try it out" with your bearer token, or curl.
- [ ] `— backend` `POST /api/portals/<id>/messages` with a 20,001-character `message` → `400 PORTAL_INVALID_PAYLOAD` naming `message`.
- [ ] In an existing portal's chat, paste 20,001 characters and press Submit. A toast names the refusal, and **the text comes back into the composer**, not lost.

## §4 — A refused first question (slices 2, 3 and 4)

- [ ] `— backend` Force the day limit: `docker exec portalai-redis-1 redis-cli SET "usage:rate:agent-turns:<orgId>:day:$(node -p 'Math.floor(Date.now()/86400000)')" 1000 EX 86400`
- [ ] On the dashboard, start **"Summarize this station's data."** in Playground.
- [ ] A **new portal still opens**. Its composer holds "Summarize this station's data." with the caret at the end. Above it the turn-limit notice reads "You've reached your plan's agent-turn limit for today. It resets at midnight UTC." with View plans on a non-pro tier. No answer streams.
- [ ] `— backend` `db:studio` → `portal_messages` for that portal: **no rows**. The `POST /api/portals` response (network panel) was `201` with `initialMessage: {"status":"refused","code":"AGENT_TURN_LIMITED", …}` and **no `Retry-After` header**.
- [ ] Press browser Back, then Forward. The composer isn't re-seeded and the notice doesn't come back: the history state was cleared.
- [ ] In that portal, press Submit on the seeded question. The send is refused with the same notice, and the question **stays in the composer**.
- [ ] Clear the forced limit (§Reset). Submit again: the notice clears, and the answer streams (1 turn).

## §5 — Resume only the new portal's first question (slice 3, narrowed in code review)

- [ ] The §1 walk already showed a new portal answering its first question on arrival.
- [ ] Reload that portal after its answer finishes. No new answer starts: no new `/stream` request in the network panel, and the conversation is unchanged.
- [ ] `— backend` An older unanswered question isn't re-run. In `db:studio`, add a `user` row as the newest message of a live (not deleted) portal of yours that already has an answer (`portal_messages`: `role` = `user`, `blocks` = `[{"type":"text","content":"stale question"}]`, `created_by` = your user id, `created` = now). Open that portal: "stale question" shows, **no** `/api/sse/portals/<id>/stream` request is made, and the turn counter doesn't move: `docker exec portalai-redis-1 redis-cli GET "usage:rate:agent-turns:<orgId>:day:$(node -p 'Math.floor(Date.now()/86400000)')"` reads the same before and after. Delete the row afterwards.
- [ ] `— manual` A reader never starts a turn. With a portal grant on someone else's portal that ends in their unanswered question, opening it as the reader starts no stream, and the composer is locked with "You can read this portal, but not send messages in it."

## §6 — The rest of the launcher is unchanged (slice 5)

- [ ] The header's **Open Portal** main click still starts a portal in the named station (no first question) and opens it, with no answer starting (1 portal, 0 turns).
- [ ] Header Open Portal menu → **Choose station…** opens the chooser dialog. Creating from it works.
- [ ] A station page's Open Portal still starts a portal in that station.
- [ ] The command palette (⌘K or Ctrl+K) still lists "Open Portal" actions, and one works.

## §7 — Failure and gates (slice 4)

- [ ] `— backend` Make a create fail: stop the API (`Ctrl+C` on its process), type a question on the dashboard, press Start. The box shows an inline alert, **not a toast**, and keeps the typed question. Restart the API.
- [ ] Navigate to Stations and back to Dashboard. The old alert is **gone**: a fresh visit shows no earlier failure.
- [ ] `— manual` As a caller without portal create access (a custom policy denying `portal` create), Start is disabled and described "Ask for access to start portals".

## §8 — Docs and API reference (slice 5)

- [ ] Help → Getting Started, "Open a portal": starts with "Type a question in the dashboard's start box, pick a station, and press Enter".
- [ ] Help → FAQ, "How do I start asking questions about my data?": mentions the start box and its station search.
- [ ] Help → Glossary, "Portal": "Start one from the dashboard with your first question, or with Open Portal at the top of any page."
- [ ] Help → Troubleshooting, "The assistant says I've reached my turn limit": says a question started from the dashboard waits in the portal's message box. Help search for **"my question didn't send"** finds it.
- [ ] Swagger at `http://localhost:3001/api/docs`:
  - `POST /api/portals` shows the `CreatePortalBody` request with optional `initialMessage`, and a 201 with `portal: {id}` and `initialMessage` (`InitialMessageOutcome`);
  - `POST /api/portals/{id}/messages` shows `SendMessageBody` and a 429;
  - `GET /api/portals` documents `include=station`.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/portal ids):
