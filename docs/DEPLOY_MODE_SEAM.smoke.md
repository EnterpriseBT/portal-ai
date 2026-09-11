# deploy-mode-seam — Smoke Suite

Manual smoke test for [#579](https://github.com/EnterpriseBT/portal-ai/issues/579) — the `DEPLOY_MODE` seam (`saas` default | `residency`): fail-fast boot guard, mode-selected auth config, saas-only Stripe webhook, lazy Anthropic client. **Branch under test:** `feat/deploy-mode-seam` (PR [#591](https://github.com/EnterpriseBT/portal-ai/pull/591)).

**All steps are `— manual`.** This ticket has no browser surface — verification is env config + process boot + `curl` + exit-code/log inspection, which `/smoke-walk` (a browser driver) cannot perform. Walk it against your own API stack.

## Preflight

### Environment
- [ ] `git checkout feat/deploy-mode-seam && git pull --ff-only`
- [ ] `npm install` — no migration (no schema change).
- [ ] From a clean `apps/api/.env` (default, `DEPLOY_MODE` unset), `npm run dev` boots cleanly (API :3001, web :3000). Boot log shows `Deploy mode resolved { deployMode: "saas" }`.

### Fixtures
- [ ] Your usual local dev org/login (bbgrabbag@gmail.com) and a working `apps/api/.env` with the normal saas values (Stripe test keys, `AUTH0_*`, `ANTHROPIC_API_KEY`).
- [ ] Keep a backup of `apps/api/.env` — several steps edit it: `cp apps/api/.env /tmp/env.saas.bak`.

### Reset between runs
- [ ] After the residency/guard steps, restore saas: `cp /tmp/env.saas.bak apps/api/.env` and restart `npm run dev`. Read-only otherwise (no DB writes introduced).

## §1 — Default saas unchanged (acceptance 1)

With the default `.env` (`DEPLOY_MODE` unset or `saas`), `npm run dev` running:

- [ ] **Boot log** shows `Deploy mode resolved { deployMode: "saas" }` and the server starts normally.
- [ ] **Stripe webhook still routes** (not 404): `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/webhooks/stripe -H "stripe-signature: t=1,v1=x" -H "content-type: application/json" -d '{}'` → **400** (missing/invalid signature) — the route exists and reaches the signature check, *not* 404.
- [ ] **Auth is Auth0**: sign into the web app (bbgrabbag@gmail.com) and load an authenticated view — API calls succeed (Auth0-issued token validates), exactly as today.
- [ ] **Agent works**: run a normal agent prompt in a station (or a visualize prompt) — it completes, confirming the lazy `getAnthropic()` behaves identically when the agent is used.

## §2 — Residency mode (acceptance 2)

Edit `apps/api/.env`: set `DEPLOY_MODE=residency`, set `OIDC_ISSUER=https://<any-valid-https-url>` and `OIDC_AUDIENCE=https://api.residency.test`, and **comment out `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`**. Restart `npm run dev`.

- [ ] **Boots** and the log shows `Deploy mode resolved { deployMode: "residency" }`.
- [ ] **Stripe webhook handler is gone**: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/webhooks/stripe -H "stripe-signature: t=1,v1=x" -d '{}'` → **401** — the route is unregistered on the webhook router, so the request falls through to the `/api` protected router and `jwtCheck` rejects it. The proof is the **400→401 change vs §1** (saas returns 400 from the Stripe signature check; residency never reaches a Stripe handler). Either way no Stripe event is processed.
- [ ] **Health still serves**: `curl -s http://localhost:3001/api/health` → 200 with `"success":true`.
- [ ] **Auth verifies against the OIDC issuer**: the JWKS/issuer `jwtCheck` now uses is `OIDC_ISSUER` (not Auth0). A token from the configured OIDC issuer validates; an Auth0 token is rejected (401). *(Full end-to-end needs a real customer OIDC — for local smoke, confirm the boot used the OIDC config and a request with an Auth0 token now 401s.)*
- [ ] **No vendor client at boot**: additionally comment out `ANTHROPIC_API_KEY` and restart — the app still **boots cleanly** (the Anthropic client is constructed lazily, so an agent-less residency install instantiates nothing outbound at boot; no boot error).

## §3 — Boot guard fails closed (acceptance 3)

Each case: edit `.env`, run `npm run dev` (or `npm run --workspace @portalai/api build && node apps/api/dist/index.js`), observe the process **exits non-zero** with a `DEPLOY_MODE_CONFIG_INVALID` fatal log, and does **not** start listening.

- [ ] **residency + a Stripe key**: `DEPLOY_MODE=residency` with `OIDC_*` set **and** `STRIPE_SECRET_KEY` present → boot fails: fatal log "Deploy-mode config is inconsistent…" mentioning Stripe; `echo $?` after exit is non-zero.
- [ ] **residency missing OIDC**: `DEPLOY_MODE=residency`, no `OIDC_ISSUER`/`OIDC_AUDIENCE`, no Stripe → boot fails, message mentions OIDC.
- [ ] **unknown mode**: `DEPLOY_MODE=prod` → boot fails with the "Unknown DEPLOY_MODE" message.
- [ ] **saas is never tripped**: restore the default saas `.env` (Stripe keys present, no OIDC) → boots normally (the guard is inert for a today-valid saas config).

## §4 — Config documentation (acceptance 4)

- [ ] `apps/api/.env.example` documents `DEPLOY_MODE`, `OIDC_ISSUER`, `OIDC_AUDIENCE` (so `env-example-parity` — a CI gate — stays green). Confirm the three appear with their comments.

## Sign-off

- [ ] Every section above verified
- [ ] ______ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (`.env` DEPLOY_MODE + which vars): · Identifiers (boot log line, exit code):
