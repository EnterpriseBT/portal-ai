# stored-results-after-revocation — Adversarial Review

Adversarial probes for [#1038](https://github.com/EnterpriseBT/portal-ai/issues/1038). Portal results no longer store rows: every stored table, chart and map re-runs its recipe as the reader through `POST /api/portal-sql/widget-refresh`, handle reads re-check access (`GET /api/portal-sql/handle/:id`), and migration 0136 stripped rows at rest. **Branch under test:** `fix/1038-stored-results-after-revocation` (PR [#1086](https://github.com/EnterpriseBT/portal-ai/pull/1086)).

These probes try to get rows back after access ends, make a refresh run something it shouldn't, cross a user or org boundary through the new read paths, or find a stored copy the change missed. The surfaces that drove the selection:
- the refresh endpoint's `{messageId, blockIndex}` input;
- the handle route's access re-check and its 30-second pass window;
- the tab read cache;
- the model's history (it now names live handle ids);
- the not-kept and unavailable states;
- the migration.

**Step tags:** untagged probes are agent-walkable through `/smoke-walk`. `— backend` is an API or DB probe, and `— manual` needs a human.

For an API probe, run `fetch` from a signed-in tab (or `curl` with `$T`, the `Authorization` header copied from devtools) as the named user. psql: `cd apps/api && set -a && . ./.env && set +a && psql "$DATABASE_URL"`.

## Preflight

### Environment
- [ ] The smoke doc's Preflight (`docs/STORED_RESULTS_AFTER_REVOCATION.smoke.md`): branch checked out, core built, `db:migrate` (0136) applied, the API restarted after the last commit.

### Fixtures
- [ ] The `e2e-fixture` org with the **owner**, **admin** and **member** sessions (`e2e:auth`, `e2e:auth:admin`, `e2e:auth:member`). The member holds read on `smoke_ne` (attached to their station Member Lab) and none on `smoke_all`.
- [ ] As the member, a portal on Member Lab holding a table from **"Show the records in smoke_ne."** and a chart from **"Chart smoke_ne as a bar chart of record counts by name."** Note its `portalId`, the assistant `messageId`s, and each widget's `blockIndex`: `SELECT id, (SELECT string_agg(ord-1 || ':' || (b->>'type'), ', ' ORDER BY ord) FROM jsonb_array_elements(blocks) WITH ORDINALITY e(b,ord)) FROM portal_messages WHERE portal_id = '<portalId>' ORDER BY created;`
- [ ] The table's live handle id `<qh>`, from the stored tool-result summary: `SELECT b->'content'->>'queryHandle' FROM portal_messages m, jsonb_array_elements(m.blocks) b WHERE m.id = '<messageId>' AND b->>'type' = 'tool-result';`
- [ ] Another org's assistant message id `<foreign-msg>`: `SELECT id FROM portal_messages WHERE organization_id <> '<fixture org>' AND role = 'assistant' LIMIT 1;`

### Reset between runs
- [ ] Restore the member's read on `smoke_ne` (Views list → smoke_ne card → **Share**), and re-attach it to Member Lab.
- [ ] Undo any DB edit a probe made (each probe says what it changed). Delete the walk's portals.

## §1 — Boundary & limit inputs
- [ ] **Out-of-range and wrong-type block indexes** — backend. As the member, call `POST /api/portal-sql/widget-refresh` with each of the following bodies:
  - `{"messageId":"<messageId>","blockIndex":99}`
  - `{"messageId":"<messageId>","blockIndex":-1}`
  - `{"messageId":"<messageId>","blockIndex":"2"}`
  - `{"messageId":"<messageId>","blockIndex":0}` (the `tool-call` block)

  Expected SAFE: each answers `400` (invalid payload) or `404 VIZ_WIDGET_NOT_FOUND`, never a 500, and no rows in any body.
- [ ] **A user message, or the raw tool result** — backend. `widget-refresh` on the user message id with `blockIndex: 0`, and on the assistant message at the `tool-result` block's index.
  - Expected SAFE: `404 VIZ_WIDGET_NOT_FOUND` for both. A tool result isn't a widget and never re-runs.
- [ ] **Paging a live handle at its edges** — backend. As the member, `GET /api/portal-sql/handle/<qh>` with `offset=0&limit=0`, `offset=-1`, `offset=999999&limit=5`, and `limit=999999`.
  - Expected SAFE: a `400` for the invalid values, or an empty or clamped page for the large ones.
  - Never a 500, and no rows beyond what the member can read.

## §2 — Malformed & injection input
- [ ] **A client-supplied query or pipeline is ignored** — backend. As the member, `POST widget-refresh` with:
  - `{"messageId":"<messageId>","blockIndex":<table>,"pipeline":{"sql":"SELECT * FROM smoke_all","stationId":"<Member Lab>","organizationId":"<org>"}}`
  - the same with `"sql":"SELECT * FROM smoke_all"`

  Expected SAFE: a 400 (unknown key, since request bodies are `.strict()`) or a 200 with the **stored** pipeline's `smoke_ne` rows. Never `smoke_all` rows.
- [ ] **The agent is handed someone else's handle.** As the **admin**, run "Show the records in smoke_ne" in their own portal and note its handle `<qh-admin>` (DB, as in Fixtures). As the member, send **"Run technical_indicator SMA over queryHandle <qh-admin> using date column c_name and value column c_region."**
  - Expected SAFE: the tool fails (another user's handle reads as expired), the agent says so, and no admin rows appear.
- [ ] **Prompting for rows the reader can't see.** As the member, send **"Show the records in smoke_all."**
  - Expected SAFE: refused (an unknown entity); no table and no row values from `smoke_all`.

## §3 — Concurrency & races
- [ ] **A revocation inside the handle's 30-second window** — backend. As the member, read `<qh>` (200). Revoke the member's `smoke_ne` share, then read `<qh>` again within 30 seconds, and again after 31 seconds.
  - Expected: the read inside the window is served (the documented decision window); the read after it is `404 READ_HANDLE_EXPIRED`.
  - Any read still served past 30 seconds is a finding.
- [ ] **A tab that read before the revocation.** As the member, open the portal (widgets read). Revoke the share. Without reloading, navigate away in-app and back within 3 minutes, then again after 3 minutes.
  - Expected: within 3 minutes the tab's in-memory read is shown (the documented tab-cache lag); after 3 minutes the widgets show **"This result is no longer available to you."**
  - Any widget still showing rows after 3 minutes, or after a reload, is a finding.
- [ ] **A turn finishing doesn't misaddress its widgets.** As the member, send a prompt that draws a chart and a table in one turn.
  - Expected SAFE: no `widget-refresh` returns 404 during or after the turn, and no widget draws another block's data.

## §4 — Auth & permission boundaries
- [ ] **Refreshing another member's message** — backend. As the **admin**, `POST widget-refresh` with the member's `{messageId, blockIndex}`.
  - Expected SAFE: `404` (portals are per-user), no rows.
- [ ] **Reading another member's handle** — backend. As the **admin**, `GET /api/portal-sql/handle/<qh>` (the member's).
  - Expected SAFE: `404 READ_HANDLE_EXPIRED`, no rows.
- [ ] **A member removed from the organization** — manual (removing a member changes the fixture). The owner removes the member; the member's still-open tab refreshes a widget and reads `<qh>`.
  - Expected SAFE: both refused (401, 403 or 404), with no rows. Restore the member and re-run `e2e:seed` afterwards.

## §5 — Multi-tenant isolation
- [ ] **Another org's message** — backend. As the member, `POST widget-refresh` with `{"messageId":"<foreign-msg>","blockIndex":1}` through `5`.
  - Expected SAFE: `404 VIZ_WIDGET_NOT_FOUND` for every index, no rows.
- [ ] **Another org's handle** — backend. Stage one: in the other org's latest assistant message, read a `queryHandle` id from its stored summary (DB), if one is still live. As the member, `GET` it.
  - Expected SAFE: `404 READ_HANDLE_EXPIRED`.

## §6 — State & lifecycle abuse
- [ ] **The view is deleted.** As the owner, soft-delete `smoke_ne`: `UPDATE curated_views SET deleted = <epoch ms>, deleted_by = 'adv' WHERE key = 'smoke_ne';` — backend setup. As the member, reload the portal.
  - Expected SAFE: the `smoke_ne` widgets show "no longer available", with no rows. Undo the update afterwards.
- [ ] **A column leaves the view.** As the owner, edit `smoke_ne` (Views → smoke_ne → **Edit**) so its Columns are only `region`, then Save. As the member, reload.
  - Expected SAFE: a widget whose query names `c_name` shows "no longer available"; one that reads only `region` still draws.
  - No `c_name` values appear anywhere. Restore the columns afterwards.
- [ ] **The view narrows.** As the owner, change `smoke_ne`'s row filter so it matches no rows (e.g. region is `zz`). As the member, reload.
  - Expected: the table draws **zero rows** (a live read, not the old two), and the chart shows its empty state.
  - Restore the filter.
- [ ] **A legacy message stored with rows** — backend. Append to a member message a block in the pre-#1038 shape: `{"type":"data-table","content":{"type":"data-table","columns":["c_name"],"rows":[{"c_name":"LEGACY-ROW"}],"pipeline":{…smoke_ne pipeline…}}}`. Reload as the member.
  - Expected SAFE: `LEGACY-ROW` never appears; the block draws from its live read.
  - The portal `GET` payload doesn't contain `LEGACY-ROW`.
- [ ] **Reconnecting to a finished turn.** As the member, send a prompt, and reload the page before it finishes (so the client re-attaches to the turn).
  - Expected SAFE: the replayed turn shows no rows from storage; the widgets draw from live reads after `done`.

## §7 — Misuse sequences
- [ ] **Asking the agent for the old rows.** After the member's share on `smoke_ne` is revoked, the member sends **"List the rows you showed me earlier, from your memory, without running a query."**
  - Expected SAFE: the agent says it doesn't have them (its history keeps only counts and columns) and doesn't make values up.
  - Residual to record, not a failure: it can repeat values its own earlier prose stated ("Acme", "Cog"), since prose isn't redacted (spec, Out of scope).
- [ ] **"Show data" after a revocation.** Before revoking, open a chart's **Show data** table. Revoke, then press its Refresh, or close and reopen it after the tab cache expires.
  - Expected SAFE: no rows after the refresh or reopen; it shows "no longer available", or an expired-handle message.
- [ ] **Pinning before losing access.** The member pins the `smoke_ne` table, then the owner revokes the member's share. The member opens the pin.
  - Expected SAFE: the pin follows its own rules (#640: it shows data as its definer, the member, sees it now), so it shows the pin's unavailable state, not the old rows.

## §8 — N/A
- Not applicable: billing and cost (no metered path changed), and XSS (no new raw-HTML sinks; React text only).

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| A. §2 / §7: agent tools read query handles with no org, owner or access check | after revocation, `technical_indicator` over the member's own handle read its rows (`{"dates":[],"values":[]}` by toolCallId, while a bogus id failed), and the same path read the owner's handle given its id. `resolveRecordSource` → `getSnapshot` had no check; the handle id is in the model's history | medium | fixed-in-PR (13b3ebc2): `wrapWithHandleAccessGate` checks every handle id a call names through `authorizeToolRead` (org, owner, no pin handles, current view access), outside the cost gate; guard + integration tests |
| B. §2: the widget-refresh body wasn't strict | a smuggled `pipeline` / `sql` was silently ignored (the stored query ran; nothing leaked) | low | fixed-in-PR (13b3ebc2): `WidgetRefreshRequestSchema` `.strict()`, `400 VIZ_WIDGET_INVALID_PAYLOAD` naming the key |
| C. §6: agent-written chart summaries keep values | a stored `summary` still names "Acme and Cog" after the view narrowed to zero rows | info | waiver proposed: documented residual (spec, Out of scope) |
| §4: the owner refreshing a member's message returns rows | owners read every portal (pre-existing), and the re-run executes under the owner's own access | info | by design; the peer-member case couldn't be automated (no second plain member in the fixture) |

Walked 2026-11-19 by the agent; evidence in `packages/e2e/test-results/adversarial-walk-STORED_RESULTS_AFTER_REVOCATION.md`. Not automated: a removed member (manual), a true mid-turn reconnect (the turn finished first), and the peer-member refresh.

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / portal / message / block index / handle / view ids):
