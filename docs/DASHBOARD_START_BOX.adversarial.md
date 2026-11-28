# dashboard-start-box — Adversarial Review

Adversarial probes for [#1079](https://github.com/EnterpriseBT/portal-ai/issues/1079): the dashboard's start box, which creates a portal with its first question in one request (`POST /api/portals` with `initialMessage`), consults the agent-turn ceiling on create, and hands the outcome to the portal page in history state. **Branch under test:** `feat/1079-dashboard-start-box` (PR [#1137](https://github.com/EnterpriseBT/portal-ai/pull/1137), into `epic/dashboard-redesign`).

Steps tagged `— backend` are API, Redis or DB probes outside the browser (send them with your bearer token from the network panel, or Swagger "Try it out"). `— manual` needs a human. Every other probe is walkable by `/smoke-walk`.

## Preflight

### Environment

- [ ] `git checkout feat/1079-dashboard-start-box && git pull --ff-only && npm install && npm run build --workspace @portalai/core`, then restart the API (nodemon doesn't watch core). `npm run dev` boots (API :3001, web :3000).
- [ ] Signed in as the e2e owner; the member fixture exists (`e2e:auth:member`, switch with `e2e:use member`).

### Fixtures

- [ ] A current `e2e-fixture` org (`e2e:seed`): **Playground** and **Administrate** stations, standard tier (9 agent turns a day). Note its org id (`<orgId>`) and Playground's station id (`<playgroundId>`).
- [ ] A station the **member** can't read: one the owner creates and doesn't share (`<privateId>`).
- [ ] A station id from a **different** org (`<foreignStationId>`), e.g. any org in `db:studio` → `stations`.
- [ ] Redis runs in `portalai-redis-1`. The day counter is `usage:rate:agent-turns:<orgId>:day:$(node -p 'Math.floor(Date.now()/86400000)')`; read it with `docker exec portalai-redis-1 redis-cli GET "<key>"`.

### Reset between runs

- [ ] Clear the turn counters: `docker exec portalai-redis-1 redis-cli --scan --pattern 'usage:rate:agent-turns:<orgId>:*' | xargs -r -n1 docker exec portalai-redis-1 redis-cli DEL`
- [ ] Portals created by the probes can stay.

## §1 — Boundary & limit inputs

- [ ] Type a question of **exactly 20,000 characters** in the start box and press Start (1 turn) — expected SAFE: accepted, a portal opens; `portal_messages` holds the full 20,000 characters, uncut.
- [ ] Type a question of 20,000 **emoji** (`"😀".repeat(20000)`, 40,000 UTF-16 units) — expected SAFE: the box and the API agree. Either both accept it or both refuse it with the same "Question must be 20000 characters or fewer"; never a box that accepts and an API that 400s (or the reverse).
- [ ] A question of only spaces and newlines — expected SAFE: Start stays `aria-disabled` ("Type a question to start"); Enter does nothing; no `POST /api/portals`.
- [ ] A question with leading/trailing whitespace, `"   Top accounts   "` (1 turn) — expected SAFE: the stored user row is `"Top accounts"` (trimmed), and the composer shows no stray whitespace.
- [ ] `— backend` Ceiling at the edge: set the day counter to **8**, then start a question (the 9th turn) — expected SAFE: admitted (`initialMessage.status: "pending"`); counter reads 9. Start another — refused (`AGENT_TURN_LIMITED`), counter 10, portal still created with no message row.

## §2 — Malformed & injection input

- [ ] Start a question containing markup: `<img src=x onerror="alert(1)"><script>alert(2)</script> **bold**` (1 turn) — expected SAFE: no alert fires; the user message renders as text (the tags visible as characters), on the portal page and in any title or preview.
- [ ] Refused-path markup: force the day limit, then start the same markup question — expected SAFE: the composer holds it as plain text; no alert fires; the notice text is the server's, not the question.
- [ ] `— backend` `POST /api/portals` with `{"stationId":"<playgroundId>","initialMessage":"a\u0000b"}` — expected SAFE: `400 REQUEST_INVALID_CHARACTERS`; no portal row, counter unchanged.
- [ ] `— backend` `POST /api/portals` with `{"stationId":"<playgroundId>","initialMessage":123}` and with `{"stationId":"<playgroundId>","initialMessage":["a"]}` — expected SAFE: `400 PORTAL_INVALID_PAYLOAD` naming `initialMessage`; no portal, counter unchanged.
- [ ] `— backend` Unknown key: `{"stationId":"<playgroundId>","initialMessage":"hi","status":"pending"}` — expected SAFE: `400 PORTAL_INVALID_PAYLOAD` naming the unknown key (strict body); nothing written.
- [ ] Station search with LIKE wildcards and quotes: type `%`, then `_`, then `' OR 1=1 --` into "Search stations" — expected SAFE: matched literally (`%` doesn't list every station), no error, "No stations match" where nothing matches; no 500 in the network panel.
- [ ] Hostile history state: on one of your portals, run `history.replaceState({...history.state, refusedInitialMessage: {prompt: "<img src=x onerror=alert(3)>", message: "<b>forged</b>"}}, "")` in the console, then reload — expected SAFE: no alert fires and no markup renders. The prompt may be seeded into the composer and the notice may show "<b>forged</b>", but only as literal text, and nothing is sent until you press Submit.

## §3 — Concurrency & races

- [ ] Double submit: type a question and press **Enter twice quickly**, then click Start right after (1 turn) — expected SAFE: exactly **one** `POST /api/portals`, one portal, one user row; the counter moves by 1.
- [ ] `— backend` Two creates at the last turn: set the counter to **8**, then send two `POST /api/portals` with different `initialMessage`s in parallel (`curl … & curl … & wait`) — expected SAFE: exactly one `pending` and one `refused` (the ceiling's increment is atomic); both portals exist, only the admitted one has a user row.
- [ ] Two tabs on the dashboard: start a question in tab A, and before it lands start another in tab B (2 turns) — expected SAFE: two separate portals, each answering its own question; neither tab shows the other's error or draft.
- [ ] Back during a pending start: press Start and immediately press browser Back — expected SAFE: the portal is still created and Recent portals lists it after a refresh (the list refresh rides the call's `invalidate`); the dashboard shows no stale alert; the question isn't answered twice.

## §4 — Auth & permission boundaries

- [ ] `— backend` As the **member**, `POST /api/portals` with `{"stationId":"<privateId>","initialMessage":"hi"}` — expected SAFE: `404` (unreadable is absent); no portal row; the day counter is **unchanged** (validation runs before admission).
- [ ] As the **member**, open the start box chip and search for the private station's name — expected SAFE: it's never listed (not in suggestions, not in search results).
- [ ] As the **member**, with a portal of their own on a station whose share is then removed: the chip's "Recent stations" doesn't offer it, and `GET /api/portals?include=station` returns that portal with `"stationName": null` — expected SAFE: the station's name isn't disclosed after the share ends.
- [ ] `— manual` A caller whose policy denies `portal` create: drive Start anyway (remove `aria-disabled` in devtools and click, or send the POST) — expected SAFE: `403 PERMISSION_DENIED`, the box shows it inline; no portal, counter unchanged.
- [ ] `— manual` A reader with a portal grant on someone else's portal that ends in an unanswered question, arriving with `pendingInitialMessage: true` forced into history state (`history.replaceState({...history.state, pendingInitialMessage: true}, "")`, reload) — expected SAFE: no stream opens (resume needs write); the composer stays locked.

## §5 — Multi-tenant isolation

- [ ] `— backend` `POST /api/portals` with `{"stationId":"<foreignStationId>","initialMessage":"hi"}` — expected SAFE: `404`, no portal in either org, **this** org's counter unchanged, and the response names nothing about the foreign station.
- [ ] `— backend` `GET /api/portals?include=station` — expected SAFE: every returned portal belongs to `<orgId>`; no `stationName` from another org appears.
- [ ] `— backend` Search: `GET /api/stations?search=<a word only in another org's station name>` — expected SAFE: no foreign station returned.

## §6 — State & lifecycle abuse

- [ ] Station deleted after the chip loaded: open the dashboard with the chip on a station, delete that station in another tab, then Start (0 turns) — expected SAFE: the box shows the refusal inline (`404`, "station … not found"), keeps the question, no toast; no orphan portal; counter unchanged.
- [ ] Preselected station deleted before load: delete the station of your most recent portal, then open the dashboard — expected SAFE: the chip reads "Pick a station" (never a deleted station's name), Start is gated until a station is picked.
- [ ] Station picked from search, then deleted before Start — expected SAFE: the same inline 404 as above; the chip doesn't silently switch to another station.
- [ ] Refused portal, reloaded: after a refused start lands, press reload before submitting — expected SAFE: the composer is empty and no notice is re-raised from state (history was replaced); no turn runs; nothing crashes. (The question isn't recoverable after a reload; record whether that's acceptable.)
- [ ] Forced resume on an old portal: on a portal of yours whose newest message is your own unanswered row (insert one as in the smoke's §5), run `history.replaceState({...history.state, pendingInitialMessage: true}, "")` and reload — expected SAFE: nothing beyond what that caller can already do. A stream may open, since it's their own portal and they can write to it, and that's no more than requesting `/api/sse/portals/<id>/stream` directly. Record whether the day counter moves: the stream route answers a pending row without ceiling admission, which the code review recorded as pre-existing, so a stream with no counter change is that known gap (Findings: pre-existing), not a regression.
- [ ] Portal deleted while its first question streams: start a question, and while it's answering delete the portal from another tab's Recent portals — expected SAFE: the stream ends cleanly; the portal page shows it's gone; no assistant row is written to a deleted portal (`db:studio`).

## §7 — Misuse sequences

- [ ] Change station mid-typing: type a long question, change the chip twice, then press Enter (1 turn) — expected SAFE: the portal opens in the **last** picked station; the question is intact.
- [ ] Fast typing in station search: type `pla`, then immediately replace it with `adm` — expected SAFE: the list ends on Administrate's matches only; a slower earlier response never overwrites the later query's results.
- [ ] Close the picker mid-search (Escape after typing `zz`), reopen — expected SAFE: the search is empty and the suggestions show; the chip keeps its previous station.
- [ ] Start, then return to the dashboard with browser Back after the portal opens — expected SAFE: the box is empty (or keeps nothing stale), there's no old alert, and Back doesn't re-create the portal.
- [ ] An over-limit question, then Start the header's Open Portal instead — expected SAFE: the header opens a portal without a first question; the start box keeps its invalid draft and error; nothing from the box is sent.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §3 Double submit: a Start click after the create answered, before the dashboard unmounted | Each late click made another portal and spent another turn (4 clicks, 4 portals) | med | fixed-in-PR (`49724f2a`): the box holds Start from a start until it unmounts or fails; re-walked, 8 late clicks sent 1 request |
| §3 Back during a pending start | Portal created and turn counted, but its question was never answered, then or on a later visit | med | fixed-in-PR (`49724f2a`): the launcher marks the portal in session storage from the create's promise and the portal page answers it once on the next visit in that tab; re-walked, answered once, nothing on reload. Other tabs and a closed tab still lose it |
| §6 Forced resume via history state | A stream runs a pending row with no turn counted | low | waived: pre-existing in the stream route (recorded in the code review); only on the caller's own portal |
| §6 Refused portal reloaded | The seeded question is lost after a reload | low | waived: accepted, no turn is spent and nothing breaks |

## Sign-off

- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/station/portal ids):
