# documentation-alignment-audit — Adversarial Review

Adversarial probes for [#615](https://github.com/EnterpriseBT/portal-ai/issues/615): the documentation alignment audit. **Branch under test:** `docs/615-documentation-alignment-audit` (PR [#913](https://github.com/EnterpriseBT/portal-ai/pull/913)).

> **Scope.** Most of #615 is prose, which has nothing to break. The probes target the four code surfaces it changed:
> - the toolpack update contract (`description: null` now clears) and its dialogs;
> - the public, unauthenticated `GET /api/public/site-config` (two new tier flags);
> - the site build that parses that response;
> - the geocoding predicate that decides which tools the agent is told about.
>
> As a Task, adversarial review is waivable-with-reason under the coverage matrix. These probes are scaffolded because the toolpack and site-config contracts changed.

Tags: untagged probes are browser-drivable; `— backend` probes are `curl`/CLI/DB; `— manual` needs a human (LLM judgement, a second org).

## Preflight

### Environment
- [ ] `git checkout docs/615-documentation-alignment-audit && npm install && npm run build && npm run dev` (web :3000, API :3001, site :3002)
- [ ] Playwright MCP available; owner and member storage states present (`e2e:auth`, `e2e:auth:member`, switched with `e2e:use`)
- [ ] For `— backend` probes: an owner bearer token and a member bearer token (copy the `Authorization` header from the browser's network panel for each identity). Below, `$OWNER` / `$MEMBER` hold them, and `$API=http://localhost:3001`.

### Fixtures
- [ ] A custom toolpack in the e2e org: start the mock server (`npm run webhook:toolpack` in `apps/api`) and register `adv_615_pack` against `http://localhost:4100/schema` and `/runtime` with description "adv probe". Note its id as `$PACK`.
- [ ] A toolpack id from **another org** (`$OTHER_PACK`), for example registered from a second local org via `portalai org create` plus a session in it. — manual
- [ ] A private tier visible to one org: `portalops tier create --env local --slug adv615 --display-name "Adv 615" --visible-to-org <e2e org id> --yes`. — backend

### Reset between runs
- [ ] Delete `adv_615_pack` (and the other org's pack); `portalops tier update --env local adv615 …` or delete the row; stop the mock server.

---

## §1 — Boundary & limit inputs
- [ ] Register toolpack with a description of **exactly 2000** characters. Expected SAFE: no field error, and registration succeeds. Then edit it to **2001**. Expected SAFE: field error "Description must be 2000 characters or fewer", `aria-invalid="true"`, and Save is blocked.
- [ ] Edit `adv_615_pack` and set the description to three spaces (`"   "`), then Save. Expected SAFE: it trims to empty and is treated as a clear (`null`), never stored as whitespace. Reopening shows an empty field, and the list shows no description.
- [ ] `curl -X PATCH $API/api/toolpacks/$PACK -H "Authorization: $OWNER" -H 'Content-Type: application/json' -d '{"description":null}'` twice, the second time on an already-null description. Expected SAFE: both `200`, with `description: null`; the second is idempotent. — backend
- [ ] `curl … -d '{"description":""}'`. Expected SAFE: `400 TOOLPACK_INVALID_PAYLOAD` naming `description`; the stored value is unchanged. — backend
- [ ] `curl … -d "{\"description\":\"$(python3 -c 'print("x"*2001)')\"}"`. Expected SAFE: `400 TOOLPACK_INVALID_PAYLOAD`. The server enforces the limit, not just the dialog. — backend

## §2 — Malformed & injection input
- [ ] PATCH with `{"description": 123}`, `{"description": {}}` and `{"description": [null]}`. Expected SAFE: each is a `400 TOOLPACK_INVALID_PAYLOAD`; nothing is written. — backend
- [ ] PATCH with `{"description": null, "evil": true}`. Expected SAFE: `400` naming the unknown key `evil` (the body schema is strict); the description isn't cleared either. — backend
- [ ] PATCH with `{"description": "a\u0000b"}`. Expected SAFE: `400 REQUEST_INVALID_CHARACTERS` (#805); nothing is written. — backend
- [ ] PATCH with a body that only nulls the description, sent as `Content-Type: application/x-www-form-urlencoded` (`description=`). Expected SAFE: `415 REQUEST_UNSUPPORTED_MEDIA_TYPE`. It must never be read as `{}` and must never clear the description. — backend
- [ ] Description set to `<img src=x onerror=alert(1)>` through the Edit dialog. Expected SAFE: the list and detail views render it as text; no script runs and no image request fires (check the console and network).
- [ ] Site build against a hostile site-config: serve `{ "success": true, "payload": { "tiers": [ { …a valid tier…, "customRbac": "yes" } ], "generatedAt": "x" } }` from a local file server and build with `SITE_CONFIG_URL` pointed at it. Expected SAFE: the build **fails** naming `PublicSiteConfigResponseSchema`. A non-boolean is never coerced, and nothing is published. — backend

## §3 — Concurrency & races
- [ ] Open `adv_615_pack`'s Edit dialog in two tabs. In tab A clear the description and Save; in tab B rename the pack and Save. Expected SAFE: the pack ends up renamed **and** with no description. Tab B's PATCH carries only `name` (the dialog sends changed fields only), so it doesn't restore the old description.
- [ ] In Edit, clear the description and double-click Save (or press Enter twice). Expected SAFE: one PATCH request (the #751 single-flight), the dialog closes once, and there's no duplicate toast or error.

## §4 — Auth & permission boundaries
- [ ] As **member**: the Toolpacks list shows no Edit or Delete on `adv_615_pack` (the member lacks `write` on toolpacks).
- [ ] As **member**: `curl -X PATCH $API/api/toolpacks/$PACK -H "Authorization: $MEMBER" … -d '{"description":null}'`. Expected SAFE: `403 PERMISSION_DENIED` ("You don't have permission to …", naming no role); the description is unchanged. — backend
- [ ] Unauthenticated `curl -X PATCH $API/api/toolpacks/$PACK -d '{"description":null}' -H 'Content-Type: application/json'`. Expected SAFE: `401`; nothing written. — backend

## §5 — Multi-tenant isolation
- [ ] As the e2e owner, PATCH `{"description":null}` on `$OTHER_PACK` (another org's pack). Expected SAFE: `404`, the same answer as a nonexistent id; the other org's description is unchanged. — backend
- [ ] `curl -s $API/api/public/site-config | jq '.payload.tiers[].slug'`. Expected SAFE: `adv615` (the org-private tier) is **absent**, and only public catalog tiers appear. Each tier carries only presentation fields: no tier ids, no `visibleToOrganizationId`, no Stripe price ids, no per-tool caps or rate limits. — backend

## §6 — State & lifecycle abuse
- [ ] Delete `adv_615_pack`, then PATCH `{"description":null}` on its id. Expected SAFE: `404`; no tombstoned row is resurrected or modified. — backend
- [ ] Move the e2e org to a tier without custom toolpacks (`portalai org set-tier … standard --env local --yes`), then clear `adv_615_pack`'s description in the app. Expected SAFE: the edit is allowed (management stays available on an inactive pack, per the contract), and the pack stays *Inactive on your plan*. Restore the tier afterwards. — manual
- [ ] Turn off the `gis` pack on a station (or move to a tier without GIS), then open a portal and ask to "geocode this address". Expected SAFE: the agent names no geocoding tool and says mapping isn't available on this station or plan; it doesn't call `geocode`. — manual

## §7 — Misuse sequences
- [ ] In Edit, clear the description, then **Cancel** instead of Save. Expected SAFE: no PATCH is sent (check the network panel), and the description is unchanged on reopening.
- [ ] Register a pack whose schema URL and runtime URL are the **same** path, following the new "let GETs through, verify every POST" sample. Expected SAFE: registration succeeds (schema GET), and an unsigned `POST` to that URL from `curl` is refused by the sample's verifier with `401 SIGNATURE_MISSING`. The GET skip doesn't open the runtime. — manual
- [ ] Copy the Python sample from the Register dialog and point it at a server that also serves a data-returning `GET /records` route. Expected: the guide and dialog say only catalog endpoints should answer `GET`, and Portals AI never sends customer data over `GET`. Treat a sample that implies otherwise as a doc bug. — manual

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] `<date> <name>` — confirmed against my own running stack

## Bug-filing template
```
Section: §<n> · Probe: <text>
Expected (safe): <…>
Got: <…>
Repro: <exact request / clicks>
Identifiers: org <id> · toolpack <id> · tier <slug>
```
