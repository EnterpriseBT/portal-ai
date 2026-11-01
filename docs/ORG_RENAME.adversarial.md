# org_rename — Adversarial Review

Adversarial probes for [#907](https://github.com/EnterpriseBT/portal-ai/issues/907): renaming an organization through Settings and `PATCH /api/organization/:id` (`write org`, strict body checked field by field, `org.update` audit, best-effort Stripe sync). **Branch under test:** `feat/907-org-rename` (PR [#937](https://github.com/EnterpriseBT/portal-ai/pull/937)).

The change is an authorization-gated write on a tenant singleton, so every category applies; §6 is narrow (one probe), since an org has no locked or job-held state. Untagged probes are browser-drivable; `— backend` probes are `curl`/`psql` against the local stack; `— manual` needs a human.

## Preflight

### Environment
- [ ] `git checkout feat/907-org-rename && npm install && npm run build --workspace=packages/core && npm run dev` (web :3000, API :3001). No migration.
- [ ] Playwright MCP available; owner, admin and member sessions fresh (`e2e:auth`, `e2e:auth:admin`, `e2e:auth:member`).

### Fixtures
- [ ] `e2e-fixture` org (`<ORG>`) with an owner, an admin and a member. If the admin membership is missing, add it: `portalai member add <ORG> e2e-admin@portalsai.io --env local --yes`, then set the role to `admin` (as owner, `PUT /api/organization/members/<adminUserId>/roles {"roleSlugs":["admin"]}`).
- [ ] A **second** org id `<OTHER>` the walking identities don't belong to (`portalai org list --env local`).
- [ ] Access tokens for the backend probes, exported as `OWNER_TOKEN` / `ADMIN_TOKEN` / `MEMBER_TOKEN` (the Auth0 access token cached in each identity's `packages/e2e/.auth/*.storageState.json`). Delete any copies afterwards.
- [ ] `H='-H Content-Type:application/json'` and `U=localhost:3001/api/organization/<ORG>` for brevity.

### Reset between runs
- [ ] Rename `<ORG>` back to `e2e-fixture` as owner, and restore its default station if a probe cleared it. Audit rows are append-only; compare the newest rows only.

## §1 — Boundary & limit inputs
- [ ] Exactly 120 characters (`"a"×120`) as owner — expected SAFE: 200, stored verbatim (`length(name)=120` in `db:studio`). — backend
- [ ] 121 characters, and a 120-character name wrapped in spaces (`" " + "a"×120 + " "`) — expected SAFE: 121 → 400 `ORGANIZATION_INVALID_PAYLOAD`, nothing written; the padded 120 → 200 storing the trimmed 120 (trim runs before the limit). — backend
- [ ] A 1 MB name (`"a"×1048576`) — expected SAFE: a 4xx (400 or 413), never a 500, nothing written. — backend
- [ ] Unicode at the limit: 120 emoji (`"😀"×120`, 240 UTF-16 units) — expected SAFE: either accepted and stored intact, or a 400 naming the limit; never a truncated or mojibake name, never a 500. Record which. — backend

## §2 — Malformed & injection input
- [ ] Wrong types: `{"name":123}`, `{"name":null}`, `{"name":["A"]}`, `{"name":{"x":1}}` — expected SAFE: each 400 `ORGANIZATION_INVALID_PAYLOAD`, nothing written. — backend
- [ ] Mass assignment: `{"name":"X","stripeCustomerId":"cus_attacker"}`, `{"name":"X","tier":"enterprise"}`, `{"name":"X","ownerUserId":"<member id>"}`, `{"name":"X","deleted":1}` — expected SAFE: each 400 naming the unknown key; `stripe_customer_id`, `tier`, `owner_user_id`, `deleted` and `name` all unchanged. — backend
- [ ] U+0000 in the name: `{"name":"Acme\u0000Corp"}` — expected SAFE: 400 `REQUEST_INVALID_CHARACTERS` (#805), nothing written. — backend
- [ ] Form-encoded body: `curl -X PATCH $U -H "Authorization: Bearer $OWNER_TOKEN" -d 'name=Hijack'` — expected SAFE: 415 `REQUEST_UNSUPPORTED_MEDIA_TYPE`, nothing written. — backend
- [ ] Stored-XSS name: rename (in the dialog) to `<img src=x onerror=alert(1)>` then view Settings → Organization, the account-menu switcher and Settings → Activity — expected SAFE: the literal text renders everywhere, no alert fires, no `<img>` element is created (check the DOM).
- [ ] Bidi/control characters: rename to `Acme‮gnp.exe` and `Acme\tCorp\nLtd` — expected SAFE: accepted or refused consistently (record which); if accepted, Activity shows the summary on one line and the delete confirmation label quotes it exactly (copy-paste of the label text still matches). — backend + browser

## §3 — Concurrency & races
- [ ] Double-submit in the dialog: type a new name, then press Enter twice fast (or Enter then click Save) — expected SAFE: exactly **one** PATCH in devtools → Network and **one** `org.update` row.
- [ ] Parallel renames from two identities: fire `{"name":"Race Owner"}` (owner) and `{"name":"Race Admin"}` (admin) together (`curl … & curl … & wait`) — expected SAFE: both 200; two `org.update` rows where one's `from` equals the other's `to`; the stored name equals the `to` of the row whose `from` isn't the original. — backend
- [ ] Rename racing a default-station change: in parallel, owner sends `{"name":"Race Name"}` and admin sends `{"defaultStationId":null}` — expected SAFE: both 200; the final row has **both** the new name and `default_station_id = NULL` (neither write clobbers the other's field). — backend
- [ ] Default station racing a station delete: in parallel, owner sends `{"defaultStationId":"<S>"}` and deletes station `<S>` (`DELETE /api/stations/<S>`) — expected SAFE: the org's `default_station_id` never ends up pointing at a soft-deleted station (either the PATCH 404s `STATION_NOT_FOUND` or the delete clears it afterwards). Repeat 5×. — backend

## §4 — Auth & permission boundaries
- [ ] Member drives the API anyway: `{"name":"Hijack"}` with `MEMBER_TOKEN` — expected SAFE: 403 `PERMISSION_DENIED` "You don't have permission to edit the organization."; name unchanged; no `org.update` row. — backend
- [ ] Member smuggles the name in with a permitted field: `{"name":"Hijack","defaultStationId":null}` with `MEMBER_TOKEN` — expected SAFE: 403, and **neither** field changes. — backend
- [ ] Admin with an explicit deny: as owner, author a custom policy `deny write org` attached to the admin (needs a custom-RBAC plan; otherwise insert the policy rows as `attachUserPolicy` does in `apps/api/src/__tests__/__integration__/utils/application.util.ts`). Then as admin: Settings → Organization shows **no** Rename, and `{"name":"X"}` → 403. — backend + browser
- [ ] Stale UI after losing the permission: as admin, open the Rename dialog; in another tab (owner) apply the `deny write org` above; back in the admin tab type a name and Save — expected SAFE: the dialog shows the 403 in its FormAlert with the input kept, and after closing it the Rename button is gone (the 403 invalidated `organizations.root`).
- [ ] Unauthenticated: `curl -X PATCH $U $H -d '{"name":"X"}'` with no token — expected SAFE: 401, nothing written. — backend

## §5 — Multi-tenant isolation
- [ ] Owner of `<ORG>` renames `<OTHER>`: `curl -X PATCH localhost:3001/api/organization/<OTHER> -H "Authorization: Bearer $OWNER_TOKEN" $H -d '{"name":"Pwned"}'` — expected SAFE: 404 `ORGANIZATION_NOT_FOUND` (not 403, so the id's existence isn't confirmed); `<OTHER>`'s name unchanged; no audit row on either org. — backend
- [ ] Same with a malformed body (`{"bogus":true}`) — expected SAFE: still 404, not 400 (another org's id is never told about its body). — backend
- [ ] Owner sets a default station from `<OTHER>`: `{"defaultStationId":"<a station id in OTHER>"}` — expected SAFE: 404 `STATION_NOT_FOUND`, `default_station_id` unchanged. — backend
- [ ] Audit visibility: after a rename in `<ORG>`, sign in as a user whose current org is `<OTHER>` and open Settings → Activity — expected SAFE: no `org.update` row for `<ORG>`; the old/new names don't appear. — manual (needs an identity in another org)

## §6 — State & lifecycle abuse
- [ ] Rename a deleted org through a stale session: soft-delete a scratch org you own (`portalai seed org --name scratch-907` + `member switch`, then delete it from Settings → Danger zone), and replay a captured `PATCH /api/organization/<scratch id>` with a token minted before the delete — expected SAFE: 404 (or 401/403 from the metadata resolver), the tombstoned row's name unchanged. — backend

## §7 — Misuse sequences
- [ ] Rename to another org's exact name, then use the org switcher — expected SAFE: allowed (names aren't unique), and the switcher still distinguishes them (switching lands in the right org by id; check the URL/`current` org id after switching). — browser
- [ ] Rename, then immediately delete with the **old** name in the confirmation — expected SAFE: confirm stays disabled in the UI; `DELETE /api/organization/<ORG> {"confirmationName":"<old name>"}` → 400 `ORGANIZATION_CONFIRMATION_MISMATCH`, org not deleted. — backend + browser
- [ ] Rename to a whitespace-padded copy of the current name from the dialog (`"  <current>  "`) — expected SAFE: the dialog just closes, no PATCH, no audit row.
- [ ] Reopen after a failed rename: with the API stopped, Save a rename to get a FormAlert, Cancel, reopen — expected SAFE: no stale error on reopen, the field shows the current name, not the failed input. — manual (needs a forced failure)

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §3 default station ∥ station delete | 3 of 5 runs left `default_station_id` on a soft-deleted station: the delete cleared the default before soft-deleting the station, and that clear matched no row (and took no lock) while the PATCH's write was uncommitted. Also on `main`; the code-review fix `9d2c6c14` didn't close it. | low–med | fixed-in-PR `1d21b6ef`: station delete takes the org row lock first; deterministic integration test; live re-probe 5/5 safe |
| §2 line break in the name | API accepted `\n` in an org name; the single-line delete confirmation can't hold it, so Delete stayed disabled until a rename | low | fixed-in-PR `1d21b6ef`: the rename schema refuses line breaks ("Name can't contain line breaks") |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / user / audit row ids):
