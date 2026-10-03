# authorization-gaps — Adversarial Review

Adversarial probes for [#685](https://github.com/EnterpriseBT/portal-ai/issues/685) — SSE and mutation routes authorize server-side (org first, then the verb on the object), portals are per-user, the unauthorized `/api/admin` routes and `POST /api/jobs` are gone, and (found on the smoke walk) Enter submits every dialog form. **Branch under test:** `fix/685-authorization-gaps` (PR [#686](https://github.com/EnterpriseBT/portal-ai/pull/686)).

Most of this change is server-side, so most probes are `— backend` API calls with real tokens. The UI probes exercise the Enter fix, the one client-side change.

## Preflight

### Environment
- [ ] `git checkout fix/685-authorization-gaps && git pull --ff-only && npm install && npm run build --workspace=packages/core` (the web dev server reads core's `dist`; no migration)
- [ ] `npm run dev`; confirm `:3001` serves branch code (`POST /api/jobs` with an owner token → `404`)

### Fixtures
- [ ] The smoke doc's fixtures: `e2e:auth:all`, `owner.storageState.json` backup, `e2e-fixture` seeded, `$OWNER` / `$MEMBER` tokens, and `$OTHER` (an identity switched into a second org)
- [ ] An owner portal (`OWNER_PORTAL`), a member portal (`MEMBER_PORTAL`), an owner-created entity (`OWNER_ENTITY`) with a field mapping, an owner entity group (`OWNER_GROUP`), a tag (`TAG`)

### Reset between runs
- [ ] Delete what the probes created (portals, pins, groups, tags, toolpacks); every refusal probe must write nothing

## §1 — Boundary & limit inputs
- N/A — this change adds checks, not limits; no new size, count or pagination surface.

## §2 — Malformed & injection input
- [ ] SSE with no token, a garbage token and an expired token: `GET /api/sse/portals/$MEMBER_PORTAL/stream`, `?token=` absent / `abc` / an old JWT — expected SAFE: `401` each; no portal lookup, no turn lock taken. — backend
- [ ] SSE with the token in the header only (no `?token=`) — expected SAFE: `401` (SSE reads the query token), never a pass-through to an unauthenticated handler. — backend
- [ ] Non-UUID and SQL-ish ids in paths: `GET /api/portals/' OR 1=1--`, `PATCH /api/toolpacks/..%2F..%2Fadmin`, `DELETE /api/entity-groups/$OWNER_GROUP/members/%00` — expected SAFE: `404` (or `400`), never `500`, nothing changed. — backend
- [ ] A body `organizationId` of the caller's own org but **differently cased / padded** on `POST /api/connector-instances` (`" <org> "`, upper-cased) — expected SAFE: `403` (only the exact current org passes) and no instance written in any org. — backend

## §3 — Concurrency & races
- [ ] **Enter during a pending submit** (member or owner, browser): Create Tag → type a name → press **Enter twice quickly** (or hold Enter) — expected SAFE: exactly **one** tag is created; the second Enter is ignored while the first request is pending, as the disabled Create button is.
- [ ] **Enter mashing on a create that navigates** (owner, browser): Register toolpack (demo Lambda URLs) → press **Enter** repeatedly in the Name field — expected SAFE: one toolpack row, one signing-secret dialog; no `409 TOOLPACK_NAME_CONFLICT` toast from a duplicate.
- [ ] Two streams on one portal at once: open `MEMBER_PORTAL` in two tabs as the member and send a prompt in one — expected SAFE: one turn runs (the turn lock holds); the other tab replays the result; no duplicated assistant message in `portal_messages`. — manual

## §4 — Auth & permission boundaries
- [ ] **A pending turn authored by someone else** (owner, then member): the owner posts into `MEMBER_PORTAL` via `POST /api/portals/$MEMBER_PORTAL/messages` **without** opening the stream; then the member opens the portal — expected SAFE and by design: the turn runs as its **author** (the owner), its messages are `created_by` the owner, and the answer lands in the member's portal. The owner chose to post there, so it's the same exposure as the owner streaming it. Confirm the member can't author a message that runs as the owner: anything the member posts runs as the member. — backend
- [ ] **Read without write on a stream** (an identity with read but not write on a portal — e.g. a custom role granting `read portal`): open `/stream` while a turn is pending — expected SAFE: `403`, the turn does **not** run, and the turn lock is released (a second attempt by the owner runs normally). — backend
- [ ] **Member drives a hidden affordance** (member): `PATCH /api/organization/<org>` with `{"defaultStationId": …}`, `POST /api/toolpacks/<id>/rotate-signing-secret`, `POST /api/entity-tags` — expected SAFE: `403 INSUFFICIENT_ROLE` each, nothing written. — backend
- [ ] **Read-only sharee writes a shared pin** (member, after owner shares a pin Read): `POST /api/portal-results/<pin>/refresh`, `PATCH`, `DELETE` — expected SAFE: `403` each; pin unchanged. — backend
- [ ] **Member adds an unreadable entity to their own group** — not reachable: members can't create entity groups (class create). Expected SAFE: `POST /api/entity-groups` as member → `403`. — backend
- [ ] **Owner reaches a member's upload** (`POST /api/file-uploads/parse` with the member's `uploadIds`) — expected SAFE: `404 FILE_UPLOAD_NOT_FOUND`; uploads are the uploader's own even to an owner. — backend

## §5 — Multi-tenant isolation
- [ ] Cross-org ids **in bodies**, as `$OWNER` of `e2e-fixture`, each naming an `$OTHER`-org object:
  - `POST /api/field-mappings` with the other org's `columnDefinitionId` — expected SAFE: `404`, no mapping
  - `POST /api/entity-groups/$OWNER_GROUP/members` with the other org's `connectorEntityId` — expected SAFE: `404`, no member
  - `POST /api/layout-plans/interpret` with the other org's `connectorInstanceId` — expected SAFE: `404 CONNECTOR_INSTANCE_NOT_FOUND`
  - `POST /api/portal-results` with the other org's `portalId` + `messageId` — expected SAFE: `404 PORTAL_NOT_FOUND`, no pin
  - `POST /api/portal-sql/widget-refresh` with the other org's `messageId` — expected SAFE: `404 VIZ_WIDGET_NOT_FOUND`
  — backend
- [ ] **Org switch mid-session**: the member switches current org to their personal org (`POST /api/organization/switch`), then, with the same token, opens `MEMBER_PORTAL`'s stream (an `e2e-fixture` portal) — expected SAFE: `404 PORTAL_NOT_FOUND`; access follows the *current* org, not where the portal was made. — backend
- [ ] **Job events across orgs** after a switch: the owner switches to another org, then opens `/api/sse/jobs/<e2e-fixture job>/events` — expected SAFE: `404 JOB_NOT_FOUND`. — backend

## §6 — State & lifecycle abuse
- [ ] **Stale member**: remove the member from `e2e-fixture` (owner, Settings → Members), then replay the member's still-valid JWT on `GET /api/portals/$MEMBER_PORTAL`, its `/stream`, and `POST /api/portals/$MEMBER_PORTAL/messages` — expected SAFE: refused (no membership resolves to this org), nothing written. Re-invite afterwards. — backend
- [ ] **Demoted admin**: change the admin to member (roles), then the admin's open session reads the owner's portal (`GET /api/portals/$OWNER_PORTAL`) and its stream — expected SAFE: `404` immediately; permissions are re-loaded per request, not cached in the session. — backend
- [ ] **Deleted portal**: delete `OWNER_PORTAL`, then (owner) open its `/stream` and `/events`, and `POST /api/portal-results` pinning from it — expected SAFE: `404` each. — backend
- [ ] **Deleted toolpack**: delete a toolpack, then `PATCH` / rotate it as the owner — expected SAFE: `404 TOOLPACK_NOT_FOUND`, the soft-deleted row unchanged. — backend
- [ ] **Shared pin after its portal is deleted**: owner pins + shares Read, then deletes the source portal — expected SAFE: the member can still read the pin (pins are independent shared artifacts) **or** gets a clean `404` — never a `500` and never the deleted portal's other messages. — backend
- [ ] **Removed routes stay removed under method games**: `GET /api/jobs` still works (list), but `PUT/PATCH /api/jobs`, `HEAD /api/admin/maintenance`, `OPTIONS /api/admin/wide-table/resync` — expected SAFE: `404` (or CORS preflight only), no job enqueued. — backend

## §7 — Misuse sequences
- [ ] **Enter inside an open autocomplete** (owner, browser): Entity group → Add Member → type in "Connector Entity" until options show, press **Enter** — expected SAFE: the highlighted option is **selected**, the dialog does **not** submit.
- [ ] **Enter in a multiline field** (browser): Create Tag → Description → type a line, press **Enter** — expected SAFE: a newline is inserted; the dialog does not submit.
- [ ] **Enter with invalid input** (browser): Create Tag with an empty name → press **Enter** in the Description's sibling text field — expected SAFE: field errors show and focus moves to Name; nothing is created.
- [ ] **Enter on a typed-confirmation dialog** (owner, browser): Clear records on an entity → type the wrong label → **Enter** — expected SAFE: the error shows, no clear job is enqueued. Type the right label → **Enter** submits once.
- [ ] **Enter on a dialog that isn't a form** (browser): any confirm dialog without a form paper (e.g. a plain delete confirm) → **Enter** — expected SAFE: nothing new happens (no hidden submit is rendered there); existing keyboard behavior unchanged.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §3 Enter during a pending submit | Found while scaffolding, before the walk: `TagFormModal` with `isPending` and Enter pressed twice calls `onSubmit` **twice**. The hidden default button isn't disabled while the visible Create is, and about 24 of the 40 form dialogs don't guard `isPending` in their submit handler. A regression from this PR's Enter fix (multi-field dialogs ignored Enter before). | med | fixed-in-PR: `Modal` `submitDisabled` disables the default button whenever the visible submit is disabled; all 40 form dialogs pass it (guard test enforces); `TagFormModal` Enter-while-pending test. Re-walk §3 to confirm live. |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
