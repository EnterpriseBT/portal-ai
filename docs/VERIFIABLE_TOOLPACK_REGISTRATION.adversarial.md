# verifiable-toolpack-registration — Adversarial Review

Adversarial probes for [#911](https://github.com/EnterpriseBT/portal-ai/issues/911): a registrant can supply the toolpack's signing secret, the API signs `/schema` and `/metadata` with it, and a 401/403 from a signed fetch is `502 TOOLPACK_SIGNATURE_REJECTED`. **Branch under test:** `feat/911-verifiable-toolpack-registration` (PR [#930](https://github.com/EnterpriseBT/portal-ai/pull/930)).

New surfaces under attack: the `signingSecret` field on `POST /api/toolpacks` (and its absence on PATCH), the register dialog's secret field, the signature-rejection mapping in `toolpack-registration.service.ts` (shared by register, PATCH, refresh and the demo seed), and the demo seed's secret resolution (env var → stored → minted). Tags: untagged = browser-walkable; `— backend` = an API/DB/CLI probe; `— manual` = needs a human.

## Preflight

### Environment
- [ ] Same as the smoke doc's Preflight: branch checked out, core rebuilt, `npm run dev` up (web :3000, API :3001), the fixture owner signed in.
- [ ] The mock toolpack server is runnable (`cd apps/api && MOCK_TOOLPACK_SIGNING_SECRET=<s> npm run webhook:toolpack`, `PORT=4101` for a second one). Its log is the evidence for "no outbound request was made".

### Fixtures
- [ ] `e2e-fixture` on a tier with custom toolpacks (the local `smoke-911-custom` tier from the smoke walk works).
- [ ] The fixture owner's bearer token for API probes. For §4, either a **member** token in the same org (`e2e:auth:member`) or an org on a tier **without** custom toolpacks.
- [ ] One registered toolpack whose server holds its secret (for example `smoke_911_verified` from the smoke walk) for the lifecycle probes.

### Reset between runs
- [ ] Delete the `adv_911_*` toolpacks a probe registered. Stop every mock server between sections that change its secret.

## §1 — Boundary & limit inputs
- [ ] `POST /api/toolpacks` with `signingSecret` = `whsec_` + **42** characters, then `whsec_` + **44** characters (valid alphabet). — backend — expected SAFE: both are **400 `TOOLPACK_INVALID_PAYLOAD`**, the mock logs **no** request (validation precedes any fetch), and no row is created.
- [ ] Same POST with `"signingSecret": ""`. — backend — expected SAFE: 400, **not** treated as "omitted" (no secret is minted, nothing registered).
- [ ] Same POST with `"signingSecret": null`. — backend — expected SAFE: 400 (`null` isn't "omitted" either); no secret minted, no fetch.
- [ ] In the dialog, paste a valid secret with a leading space and a trailing newline (`" whsec_…\n"`), with the mock holding the trimmed value, then Register. — expected SAFE: either it registers with the **trimmed** value and the mock logs `Signature: VERIFIED`, or the field shows the format error. It must **not** register with a secret that differs from what the field showed.

## §2 — Malformed & injection input
- [ ] `signingSecret` with characters outside base64url at the right length: `whsec_` + 42 × `A` + `+`; also `/`, `=`, and a non-ASCII letter (`é`). — backend — expected SAFE: 400 each, no fetch.
- [ ] `signingSecret` as a number (`12345`) and as an object (`{"value":"whsec_…"}`). — backend — expected SAFE: 400 `TOOLPACK_INVALID_PAYLOAD`, and the response's `details.issues` names the field without echoing the value.
- [ ] `signingSecret` containing a NUL (`"whsec_\u0000…"`). — backend — expected SAFE: **400 `REQUEST_INVALID_CHARACTERS`** from `reject-nul`, never a 500.
- [ ] A **valid-format but wrong** secret sent to a mock that answers 401 with a body echoing the request's headers (`X-PortalAI-Signature`, …). — backend — expected SAFE: the 502's `message` and `details` carry **only** the URL and status (`{url, status}`), never the response body, the signature, or the secret.
- [ ] The error path doesn't leak the secret: after a 400 (malformed) and a 502 (mismatch) using recognisable values (`whsec_LEAKCHECK…`), grep the API log and both response bodies for `LEAKCHECK`. — backend — expected SAFE: **0** hits (`*.signingSecret` is redacted; Zod's regex issue doesn't echo the input).
- [ ] `PATCH /api/toolpacks/<id>` with `{"signingSecret":"whsec_<valid>"}` together with a real change (`"description":"x"`). — backend — expected SAFE: the **whole** PATCH is 400 (strict schema); the description is **not** updated and the stored secret is unchanged.

## §3 — Concurrency & races
- [ ] In the dialog, with the mock holding the field's secret, press **Register** twice quickly, or Enter then click. — expected SAFE: the API receives **one** POST (the mock logs one `/schema` pair) and one row is created, with no `TOOLPACK_NAME_CONFLICT` alert left in the dialog.
- [ ] Two parallel `POST`s with the same name but **different** supplied secrets, both against a mock that accepts either (no `MOCK_TOOLPACK_SIGNING_SECRET`). — backend — expected SAFE: at most one row with that name. Record the outcome, and file it if two rows exist; the name check predates #911, so a pre-existing race is noted rather than fixed here.
- [ ] Row → **Rotate signing secret**, and while the reveal dialog is still open, click **Refresh** on the same row, with the mock still holding the **old** secret. — expected SAFE: the refresh fails cleanly with the signature-rejected toast (it signed with the new secret), and the toolpack's tools are unchanged. Restarting the mock with the new secret makes the next Refresh succeed.

## §4 — Auth & permission boundaries
- [ ] As a **member** (no `resource.write` on toolpacks), `POST /api/toolpacks` with a valid `signingSecret` and the mock's URLs. — backend — expected SAFE: **403 `PERMISSION_DENIED`**, and the mock logs **no** request. Supplying a secret mustn't turn the route into a signed-request emitter for callers who can't register.
- [ ] As an owner in an org whose tier **excludes** custom toolpacks, the same POST. — backend — expected SAFE: **403 `TOOLPACK_NOT_ENTITLED`**, no outbound request, nothing persisted.
- [ ] A registered toolpack's secret is never readable back: as the owner, `GET /api/toolpacks`, `GET /api/toolpacks/<id>` and the refresh and PATCH responses for a toolpack registered with a **supplied** secret. — backend — expected SAFE: none contains the secret; only `signingSecretStatus` appears.

## §5 — Multi-tenant isolation
- N/A — #911 adds no id-addressed route or lookup. The supplied secret is written to the caller's own new row, and register, PATCH and refresh keep their existing org-scoped loads. Two orgs choosing the same secret doesn't link their toolpacks, because nothing looks a toolpack up by its secret.

## §6 — State & lifecycle abuse
- [ ] **Server rotated out from under a registered toolpack:** restart the mock for `smoke_911_verified` with a different secret, then **Refresh**. — expected SAFE: a toast with "rejected the request's signature (401)", and in the DB (`organization_toolpacks`) the row's `tools`, `schema_fetched_at` and `signing_secret` are **unchanged**. A failed refresh doesn't wipe the tool list.
- [ ] **PATCH to a server that refuses:** `PATCH /api/toolpacks/<id>` moving `endpoints.schema` to a `:4101` mock holding a different secret. — backend — expected SAFE: **502 `TOOLPACK_SIGNATURE_REJECTED`** with `details.url` = the `:4101` URL, and the row's `endpoints` and `tools` are unchanged.
- [ ] **Metadata refuses after schema verifies:** register with schema on a `:4100` mock holding the secret and metadata on a `:4101` mock holding another. — backend — expected SAFE: 502 naming the `:4101/metadata` URL, and **no** row is created (no half-registered toolpack without metadata).
- [ ] **`TOOLPACK_DISABLE_SIGNING=true`** on the API, registering against a mock that requires signatures. — backend — expected SAFE: **502 `TOOLPACK_SCHEMA_FETCH_FAILED`** ("returned 401"), **not** `TOOLPACK_SIGNATURE_REJECTED`, since no signature was sent, so the message doesn't blame a secret mismatch.
- [ ] **Demo seed, empty first entry:** `DEMO_TOOLPACK_SIGNING_SECRETS=",<secret B>"` with the mock holding B. — backend — expected SAFE (and documented): record which secret registers. The resolver skips empty entries (`.find(Boolean)`), so B registers. Check that `.env.example` and the README's "first entry" wording don't promise otherwise, or that this is the intended reading.
- [ ] **Demo seed, malformed first entry:** `DEMO_TOOLPACK_SIGNING_SECRETS="hunter2,<secret A>"`. — backend — expected SAFE: one warning naming the variable, **not** the value (grep the seed output for `hunter2`: 0 hits). The seed then falls through to the stored secret (or mints), and doesn't silently pick entry two.
- [ ] **Demo seed, env secret changed:** re-seed with `DEMO_TOOLPACK_SIGNING_SECRETS=<secret B>` while the stored row holds A and the mock holds B. — backend — expected SAFE: it registers, and the row's `signing_secret` now decrypts to B, so later runtime calls sign with what the Lambda holds. The same toolpack id is kept.

## §7 — Misuse sequences
- [ ] **Regenerate after configuring the server:** open the dialog, copy the secret, start the mock with it, then click **Generate a new signing secret** before Register. — expected SAFE: a clean in-dialog `TOOLPACK_SIGNATURE_REJECTED` alert, nothing registered, and the dialog still editable. Pasting the mock's secret back in then registers.
- [ ] **Re-register after success:** register `adv_911_a` from the dialog, reopen **Register toolpack**. — expected SAFE: the secret field holds a **new** value, not `adv_911_a`'s, so the helper text's "use a different secret for each toolpack" is the default path.
- [ ] **Auth header rejected, not the signature:** register against a mock that verifies the signature correctly but 401s on a missing `X-Api-Key`, with a **wrong** `X-Api-Key` in the dialog's auth headers. — expected SAFE: the 502 alert includes the hint "If you registered auth headers, check that your server accepts them too.", and nothing registers.
- [ ] **Redirect to another host:** a schema URL whose server answers `302 Location: http://localhost:4101/schema`. — backend — expected SAFE: the outcome matches the pre-#911 redirect behaviour (registered, or an SSRF or fetch error). Record whether the `:4101` mock received the `X-PortalAI-*` signature headers. A signature isn't the secret, so this is informational unless the secret itself is forwarded, which would be a high finding.
- [ ] **A server that answers 403 on every request regardless** (a WAF in front of the toolpack): register with a valid secret. — backend — expected SAFE: 502 `TOOLPACK_SIGNATURE_REJECTED` naming `403`, and nothing registered. Record whether the message is misleading enough to file a copy follow-up, since the signature may be fine.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/toolpack ids, mock log excerpt):
