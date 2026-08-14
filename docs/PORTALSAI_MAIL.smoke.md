# portalsai_mail — Smoke Suite

Manual smoke test for [#369](https://github.com/EnterpriseBT/portal-ai/issues/369) — `portalsai.io` mail, and every business address in the app and site derived from one write path. Covers the four DNS records, the three env-injected addresses, the removal of the public `contact` contract, and the app repoint off a personal address.

**Branch under test:** `feat/portalsai-mail`. PR not yet opened when this doc was written; add the link when it is.

**Some of this is already done and verified — do not redo it.** The DNS half of the runbook (`docs/PORTALSAI_MAIL.runbook.md` steps 2, 6, 7) was executed during implementation against the live zone `Z0000108E4DFXWIOEOR7`. §1 re-checks it rather than performing it; §7 is the part still outstanding.

Run **§Preflight** once; sections are independent after that. Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/portalsai-mail && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — the public contract changed shape, and `apps/site` validates against core's `dist/`. **A stale build fails the site build with a confusing schema error** (it did during implementation).
- [ ] **No migration.** No DB schema change, no seed. The only stateful changes are SSM parameters and DNS, both already applied.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).

### Fixtures

Nothing to seed. The addresses are static config; the Workspace mailbox and aliases already exist.

| Needed | For |
|---|---|
| A logged-in user on any org | §3 (Help view) |
| An org on a **contact/managed** tier, or any tier list showing a contact card | §4 (Contact CTA, managed banner) |
| Access to an outside mail account (not `@portalsai.io`) | §7 (delivery) |

### Reset between runs

- [ ] No reset needed — nothing here writes application data.

---

## §1 — The DNS records (re-check, already deployed)

All four were deployed and verified during implementation. This is a confirmation pass, not the deploy.

- [ ] `aws cloudformation describe-stacks --stack-name portalai-dns-email --query 'Stacks[0].{S:StackStatus,O:Outputs}'` → `CREATE_COMPLETE`/`UPDATE_COMPLETE`, and `DkimConfigured` is `"true"`.
- [ ] Resolve each record and confirm it is present:

```bash
node -e "const d=require('dns').promises;(async()=>{
  console.log('MX   ', (await d.resolveMx('portalsai.io')).map(r=>r.priority+' '+r.exchange));
  console.log('TXT  ', await d.resolveTxt('portalsai.io'));
  console.log('DMARC', await d.resolveTxt('_dmarc.portalsai.io'));
  console.log('DKIM ', (await d.resolveTxt('google._domainkey.portalsai.io')).map(p=>p.join('').length));
})()"
```

- [ ] MX lists all five Google hosts (priorities 1, 5, 5, 10, 10).
- [ ] The apex TXT carries **both** the SPF string and the `google-site-verification` token — they share one record set, and a missing one means the merge regressed.
- [ ] DMARC reads `v=DMARC1; p=none; rua=mailto:admin@portalsai.io; fo=1`.
- [ ] DKIM reassembles to **410 characters** — it is stored as two quoted chunks, and a resolver must rejoin them. A shorter result means the split is wrong, which fails authentication while looking correct in the console.
- [ ] The stack survives a re-deploy without dropping DKIM:
      `aws cloudformation deploy --stack-name portalai-dns-email --template-file infra/cloudformation/dns-email.yml --parameter-overrides HostedZoneId=Z0000108E4DFXWIOEOR7 DkimValue='<the chunked value>' --no-fail-on-empty-changeset`
      then re-check `DkimConfigured` is still `"true"`.

## §2 — The config path

- [ ] `portalops vars describe --env app-dev` lists `ADMIN_EMAIL` alongside the other two, as an SSM entry with leaf `admin-email`.
- [ ] All three app-dev values read `qa@portalsai.io`:

```bash
for l in support-email sales-email admin-email; do \
  echo -n "$l → "; aws ssm get-parameter --name "/portalai/dev/$l" --query Parameter.Value --output text; done
```

- [ ] `portalops vars set SUPPORT_EMAIL qa@portalsai.io --env app-dev --yes` succeeds and reports the site-rebuild dispatch (or notes `GITHUB_TOKEN` unset, in which case the nightly rebuild is the path — that is designed behavior, not a failure).

## §3 — The app no longer shows a personal address

With `npm run dev` running and no `VITE_*` email vars set locally, every address falls back to `qa@portalsai.io`.

- [ ] Open **Help**. The contact caption shows an address, and the **visible text matches the link target** — hover or inspect: both are `qa@portalsai.io`. (Before this ticket the text was a hardcoded personal address.)
- [ ] `grep -rn "btdev.io" apps/*/src packages/*/src` returns nothing.
- [ ] No surface anywhere renders an address outside `portalsai.io`.
- [ ] Set `VITE_SUPPORT_EMAIL=support@portalsai.io` in `apps/web/.env`, restart the dev server, reload Help → the caption now shows `support@portalsai.io`. **This is the whole point**: the address is config, not code. Revert the `.env` change afterwards.

## §4 — The contact and managed-plan CTAs

- [ ] Open **Settings → Subscription & Billing**. On a contact-tier card, the **"Contact support"** link points at the support address for this environment (`qa@portalsai.io` locally).
- [ ] On a **managed** plan, the banner reads "Your plan is managed — **contact us** to make changes", where *contact us* is a link to the **sales** address. Before this ticket it was plain text with no address at all — a dead end.

## §5 — The public endpoint no longer serves contact

- [ ] `curl -s localhost:3001/api/public/site-config | jq '.payload | keys'` → `["generatedAt","tiers"]`. **No `contact` key.**
- [ ] The endpoint returns **200**, not 503, even though no contact address is configured anywhere in the API — the fail-closed contact rule is gone with the field.
- [ ] The **price** fail-closed rule still works: it is untouched by this ticket and is what stops a Stripe outage being published as a pricing change. (If you have a way to force an unresolvable price, confirm 503 `SITE_CONFIG_PRICE_UNRESOLVED`; otherwise note it as unverified.)

## §6 — The marketing site

- [ ] `cd apps/site && SUPPORT_EMAIL=support@portalsai.io SALES_EMAIL=sales@portalsai.io ADMIN_EMAIL=admin@portalsai.io npm run build` completes, and `verify-pages` reports OK.
- [ ] `grep -o 'mailto:[^"]*' dist/terms/index.html` → the legal contact is **`admin@portalsai.io`**, not support. Same on `dist/privacy/index.html`.
- [ ] `grep -o '"email":"[^"]*"' dist/index.html` → the JSON-LD `contactPoint` carries the **support** address.
- [ ] `grep -o 'mailto:[^"]*' dist/contact/index.html` → both support and sales addresses appear.
- [ ] Now build with **no** email vars set → every address falls back to `qa@portalsai.io`, and `verify-pages` still passes. **No page contains `href="mailto:"`** with an empty target — that gate is now the primary defence, since an unset value can no longer 503.

## §7 — Mail actually arrives (the outstanding half)

The only part of the runbook not yet done. Requires the Workspace mailbox, which exists.

- [ ] From an outside account, send mail to **`admin@`**, **`support@`**, **`sales@`** and **`qa@portalsai.io`**. All four arrive in the `admin@` mailbox.
- [ ] Reply from the `admin@` mailbox to that outside account. The reply arrives, and its headers show a **DKIM pass** for `portalsai.io` (in Gmail: *Show original*).
- [ ] Run an external validator ([mxtoolbox.com](https://mxtoolbox.com) or [dmarcian](https://dmarcian.com/domain-checker/)) against `portalsai.io` → **SPF, DKIM and DMARC all pass**.
- [ ] In the Workspace console, DKIM status reads **authenticating** (after you clicked *Start authentication*).

## §8 — The one foot-gun

- [ ] Confirm the repository variable **`PORTALSAI_DKIM_VALUE`** is set (Settings → Secrets and variables → Actions → Variables) to the **chunked** value exactly as stored in Route53.
- [ ] Understand why: `deploy-dev.yml` passes it on every infra deploy. **Unset, the next deploy re-deploys the stack with an empty `DkimValue` and deletes the DKIM record.** If §1's re-deploy check dropped DKIM, this is the cause.

## §9 — Not manually verifiable (recorded, not skipped)

The spec's first criterion — all cases pass, `lint` / `type-check` / `format:check` clean — is a **CI assertion**. Confirm CI is green on the PR; that plus your sign-off is the merge gate.

---

## Sign-off checklist

- [ ] §1 (DNS) — four records live; DKIM reassembles to 410 chars; survives re-deploy.
- [ ] §2 (config) — `ADMIN_EMAIL` in the catalog; all three app-dev values `qa@`.
- [ ] §3 (app) — no personal address anywhere; visible text matches the link; changing the env var changes the address.
- [ ] §4 (CTAs) — contact card links support; managed banner links sales.
- [ ] §5 (endpoint) — no `contact` key, 200 not 503, price rule intact.
- [ ] §6 (site) — legal pages show admin@, JSON-LD shows support@, unset vars fall back to qa@ with no empty mailto.
- [ ] §7 (delivery) — all four addresses receive; a reply passes DKIM; external validator green.
- [ ] §8 (foot-gun) — `PORTALSAI_DKIM_VALUE` set.
- [ ] CI green on the PR (§9).
- [ ] `<date>` — `<name>` — walked against my own running stack.

After every box is ticked: report ready-to-merge in the PR thread, or file follow-up bugs.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <rendered address, curl output, dig/DNS result, or mail headers>
**Repro:** <exact command or click path>
**Environment:** <local | app-dev | prod>
```
