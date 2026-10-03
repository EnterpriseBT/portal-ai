# authorization-gaps — Smoke Suite

Manual smoke test for [#685](https://github.com/EnterpriseBT/portal-ai/issues/685) — SSE routes authorize like REST, portals are per-user, and every mutation route checks org and per-object permission (with the route-authorization guard). **Branch under test:** `fix/685-authorization-gaps` (PR [#686](https://github.com/EnterpriseBT/portal-ai/pull/686)).

This ticket is mostly server-side. The smoke has two halves:

- **Legitimate flows still work in the browser.** Over-refusal is the named risk (spec → Risks), so owners and members each walk their own normal paths.
- **Refusals hold against the live API.** These are `— backend` curl probes with real owner and member bearer tokens.

Sections are independent after Preflight.

## Preflight

### Environment

- [ ] `git checkout fix/685-authorization-gaps && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The core `maintenance.contract` was removed, so the API needs the rebuilt core dist. No migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000), with no YAML/swagger errors in the API log.
- [ ] Confirm `:3001` serves branch code, since a stale nodemon instance is common here: `curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3001/api/jobs -H "Authorization: Bearer $OWNER"` returns `404`, not `400` or `401`. If it doesn't, boot a fresh API: `cd apps/api && PORT=3011 npx dotenv -e .env -- tsx src/index.ts`, and use `:3011` below.

### Fixtures

- [ ] Multi-role sessions: `npm run --workspace @portalai/e2e e2e:auth:all`, then `cp packages/e2e/.auth/storageState.json packages/e2e/.auth/owner.storageState.json` so `e2e:use owner|member` switches both ways.
- [ ] Fixture org with all three roles: `npm run --workspace @portalai/e2e e2e:seed` (`e2e-fixture`; owner = `E2E_AUTH0_USERNAME`, member = `E2E_AUTH0_USERNAME_MEMBER`). Each identity switches into `e2e-fixture` in-app before walking.
- [ ] Bearer tokens for the `— backend` probes. From each storageState, take the `@@auth0spajs@@::<clientId>::https://api.mcp-ui.dev::openid` localStorage value and read `JSON.parse(v).body.access_token`. Export them as `$OWNER` and `$MEMBER`. Both identities must have `e2e-fixture` as their current org (switch in-app first).
- [ ] A second-org token `$OTHER`: the member's personal org works. Switch the member back to it and re-extract, or use any identity whose current org is not `e2e-fixture`.
- [ ] Record the ids you'll create below: `OWNER_PORTAL`, `MEMBER_PORTAL`, `OWNER_TOOLPACK`, `OWNER_INSTANCE` (an owner-created connector instance), `OWNER_ENTITY` (one of its entities), `OWNER_GROUP` (an owner-created entity group).

### Reset between runs

- [ ] Delete the portals, tag, group and connector created in the walk from the UI. Every refusal probe below must write nothing, so nothing else needs resetting.

## §1 — SSE: the portal stream and the job events (slice 1)

- [ ] **Owner** (browser): open a station in `e2e-fixture` → **New portal** → send "How many records are in each entity?". The answer streams in and the composer unlocks. Record `OWNER_PORTAL` from the URL.
- [ ] **Member** (browser, `e2e:use member`, close and navigate): open a station → **New portal** → send the same prompt. It streams in the same way. Record `MEMBER_PORTAL`.
- [ ] Reload the member's portal. The history replays: both the prompt and the answer are present.
- [ ] `— backend` `curl -s -N -H "Authorization: Bearer $MEMBER" "localhost:3001/api/sse/portals/$OWNER_PORTAL/stream"` returns `404` with code `PORTAL_NOT_FOUND`. No event lines are emitted and none of the owner's message text appears.
- [ ] `— backend` The same request for `…/$OWNER_PORTAL/events` gets `404 PORTAL_NOT_FOUND`.
- [ ] `— backend` `$OTHER` on `…/$OWNER_PORTAL/stream` gets `404 PORTAL_NOT_FOUND`.
- [ ] `— backend` Take a job id from `e2e-fixture` (`GET /api/jobs` as owner, any row). `curl -s -N -H "Authorization: Bearer $OTHER" localhost:3001/api/sse/jobs/<id>/events` gets `404 JOB_NOT_FOUND`. As `$OWNER` the stream opens (`200`, `text/event-stream`).

## §2 — Portals are per-user, and pins still share (slice 3)

- [ ] **Member** (browser): the station's portal list shows the member's portal and **not** `OWNER_PORTAL`.
- [ ] **Member** (browser): navigate directly to `/portals/$OWNER_PORTAL`. You get the not-found state, and the owner's prompt and answer are not rendered.
- [ ] **Owner** (browser): the same station's portal list shows **both** portals, and the owner can open the member's portal and read its history.
- [ ] **Owner** (browser): in `OWNER_PORTAL`, pin the answer block (**Pin** → name it "Smoke 685 pin").
- [ ] `— backend` Before sharing: `GET /api/portal-results/<pin id>` as `$MEMBER` gets `404 PORTAL_RESULT_NOT_FOUND`. A new pin is its creator's until shared (#630 rules; this branch doesn't change pin reads).
- [ ] **Owner** (browser): open the pin (`/portal-results/<pin id>`) → **More actions → Share** → Share with **The team**, Access **Read** → **Share**.
- [ ] **Member** (browser): open `/portal-results/<pin id>`. The pin renders its content (the `contacts | 6` table). Shared pins are how portal output reaches other users.
- [ ] `— backend` `curl -s -X PATCH -H "Authorization: Bearer $MEMBER" -H 'content-type: application/json' -d '{"name":"hijack"}' localhost:3001/api/portals/$OWNER_PORTAL` gets `404 PORTAL_NOT_FOUND`. In the owner's browser the portal name is unchanged.
- [ ] `— backend` The same with `-X DELETE …/$OWNER_PORTAL/messages` gets `404`. The owner's history is still intact on reload.

## §3 — Turn and job-message attribution (slice 1 + code-review fixes)

- [ ] **Owner** (browser): open `MEMBER_PORTAL` and send "List the entities in this station.". The answer streams.
- [ ] `— backend` In `db:studio` → `portal_messages`, filtered to `portal_id = MEMBER_PORTAL`: the owner's new `user` row and the assistant row that answered it have `created_by` = the **owner's** user id. The member's earlier rows carry the **member's** id.

## §4 — SQL handle snapshot and the removed stream (slice 2)

- [ ] `— backend` `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $OWNER" localhost:3001/api/sse/portal-sql/handle/any-id/stream` returns `404`. The route no longer exists.
- [ ] `— backend` Get a handle: in `OWNER_PORTAL` ask "Show me the first 50 rows of the largest entity.", then read the handle id from the tool result (`db:studio` → `portal_messages.blocks`, the `handleId` field). `GET /api/portal-sql/handle/<handleId>` returns `200` with rows as `$OWNER`, `404 READ_HANDLE_EXPIRED` as `$MEMBER` (different user), and `404 READ_HANDLE_EXPIRED` as `$OTHER`.

## §5 — Toolpacks (slice 5)

- [ ] **Owner** (browser): Settings → Toolpacks → register a custom toolpack named `smoke_685` against the running demo toolpack Lambda (#510). Its base URL is the `portalai-demo-toolpack` stack output: `aws cloudformation describe-stacks --stack-name portalai-demo-toolpack --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text`. Schema = `<base>schema`, runtime = `<base>runtime`, metadata = `<base>metadata`. Registration succeeds and lists the demo's tools. Then edit its description to "Smoke 685" and rotate its signing secret. Both succeed. Record `OWNER_TOOLPACK`.
- [ ] `— backend` `$MEMBER` sending `PATCH /api/toolpacks/$OWNER_TOOLPACK`, `POST …/refresh`, `POST …/rotate-signing-secret` and `DELETE …` each gets `403 INSUFFICIENT_ROLE`. Registering one (`POST /api/toolpacks` with the same endpoints, name `member_685`) also gets `403 INSUFFICIENT_ROLE`, not an upgrade error. The description and signing secret are unchanged afterwards. (Members can't open the Toolpacks settings at all since #630, so this half is an API check. Hiding affordances is #684.)
- [ ] `— backend` `$OTHER` sending `PATCH /api/toolpacks/$OWNER_TOOLPACK` gets `404`.

## §6 — Creates, children and same-org objects (slices 4, 6, 6c)

- [ ] **Owner** (browser): create a tag and an entity group, add an entity to the group, and tag an entity. All succeed. Record `OWNER_GROUP`.
- [ ] **Member** (browser): creating a tag, an entity group or a column definition fails with a permission error (403). No new row appears in the list on reload.
- [ ] `— backend` The member's upload path still works (the over-refusal risk). Members can't open `/connectors` since #630, so drive it by API as `$MEMBER`: `POST /api/file-uploads/presign` (a small CSV) → `PUT` the file to the returned `putUrl` → `POST /api/file-uploads/confirm` gets `200` → `POST /api/file-uploads/parse` gets `202` and its job completes → `POST /api/layout-plans/interpret` with the returned `uploadSessionId` passes authorization (any failure is about the plan content, never `404 FILE_UPLOAD_NOT_FOUND`). The same confirm and interpret calls as `$OWNER` on the member's upload get `404 FILE_UPLOAD_NOT_FOUND`: uploads are the uploader's own.
- [ ] **Member** (browser): on the member's own entity, edit a field mapping, then tag it with a tag the member can read. Both succeed (or the tag picker just doesn't offer unreadable tags).
- [ ] `— backend` `$MEMBER` sending `POST /api/entity-groups/$OWNER_GROUP/members` with `{"connectorEntityId":"<member's entity>","linkFieldMappingId":"<any>"}` gets `404 ENTITY_GROUP_NOT_FOUND`. The group's member list in the owner's browser is unchanged.
- [ ] `— backend` `$MEMBER` sending `GET /api/connector-instances/$OWNER_INSTANCE/api-endpoints` gets `404 CONNECTOR_INSTANCE_NOT_FOUND`. If `OWNER_INSTANCE` isn't a REST connector, run the layout-plan GET instead: `GET /api/connector-instances/$OWNER_INSTANCE/layout-plan` gets `404 LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND`.
- [ ] `— backend` `$OTHER` sending `PATCH /api/connector-entities/$OWNER_ENTITY` with `{"label":"x"}` gets `404`. The entity label is unchanged.
- [ ] `— backend` `$MEMBER` sending `POST /api/connector-instances` with the body `organizationId` set to `$OTHER`'s org id gets `403`, and no instance appears in the other org.
- [ ] **Member** (browser): Settings → change the organization's default station. The change is refused with a permission error. **Owner**: the same change succeeds and persists on reload.

## §7 — Removed routes (slices 6, 6b)

- [ ] `— backend` `POST /api/jobs` returns `404`, as do `GET /api/admin/maintenance`, `POST /api/admin/wide-table/resync` and `POST /api/admin/dissolve/reenqueue`. Use the `$OWNER` token for each. Nothing is enqueued (no new `jobs` row in `db:studio`).
- [ ] **Owner** (browser): the job list and job detail views still load, and cancelling a running job still works if one is available. No UI used the deleted routes.

## §8 — The route-authorization guard (slice 7)

- [ ] `— backend` On PR #686, the **Unit Tests** check is green and its log includes `route-authorization.test.ts` passing, including the self-test that an unclassified route is reported. This is CI evidence. A new unclassified route failing the build is what the self-test proves.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
