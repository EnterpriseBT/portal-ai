# portalsai.io mail — Runbook

**Issue:** [EnterpriseBT/portal-ai#369](https://github.com/EnterpriseBT/portal-ai/issues/369) · Spec: `docs/PORTALSAI_MAIL.spec.md`

The half of #369 that cannot be code. Creating a Google Workspace tenant needs a paid seat, console access, and a human — there is no API we hold a credential for. The charter classifies these steps as **out-of-band, runbook-driven** (`docs/CLI_OPERATIONS_CHARTER.md` → AWS), and this file is the executable artifact behind that classification.

**Run it in order.** Step 4 cannot happen before step 3, and step 6 cannot happen before step 5 — Google generates the DKIM key only after it has verified the domain.

**Hosted zone:** `Z0000108E4DFXWIOEOR7` (`portalsai.io`, AWS account `028987315524`).

---

## What you end up with

| Address | What it is | Environments |
|---|---|---|
| `admin@portalsai.io` | The paid seat — the real mailbox. Legal / data-controller contact, DMARC report destination, vendor account contact | prod |
| `support@portalsai.io` | Alias → admin | prod |
| `sales@portalsai.io` | Alias → admin | prod |
| `qa@portalsai.io` | Alias → admin | **local + app-dev, all three roles** |

`qa@` exists so no non-prod surface can advertise a customer-facing inbox. Aliases are free; only the seat is paid.

---

## 1 — Create the Workspace tenant

- [ ] Sign up at [workspace.google.com](https://workspace.google.com) with `portalsai.io` as the domain.
- [ ] Create the single user **`admin@portalsai.io`**. One seat is all this ticket needs.
- [ ] Stop at the point where Google asks you to verify the domain — the records for that are already in code (step 2).

## 2 — Publish the DNS records

The verification and mail records live in `infra/cloudformation/dns-email.yml`. Google's verification values are already the parameter defaults, so this needs no arguments beyond the zone.

- [ ] Deploy the stack:

```bash
aws cloudformation deploy \
  --stack-name portalai-dns-email \
  --template-file infra/cloudformation/dns-email.yml \
  --parameter-overrides HostedZoneId=Z0000108E4DFXWIOEOR7 \
  --no-fail-on-empty-changeset
```

- [ ] Confirm four records were created — MX, apex TXT, `_dmarc`, and the verification CNAME. DKIM is **absent on purpose** at this stage:

```bash
aws cloudformation describe-stacks --stack-name portalai-dns-email \
  --query 'Stacks[0].Outputs' --output table
# DkimConfigured → "false" until step 6
```

> The stack takes **no `Environment` parameter** and its name carries no environment segment. Mail is a property of the domain: one zone, one set of MX records. Per-environment *addresses* are config (SSM), not DNS.

## 3 — Verify the domain

- [ ] In the Workspace console, run the domain verification. Both methods are published (apex TXT and the CNAME), so whichever Google checks will pass.
- [ ] If it fails, wait for TTL (3600s) and retry before changing anything — DNS propagation is the usual cause, not a wrong record.

## 4 — Create the aliases

With the domain verified, add these as **aliases on the `admin@` user** (Workspace console → Users → admin → alternate email addresses). Aliases, not new users — new users cost a seat each.

- [ ] `support@portalsai.io`
- [ ] `sales@portalsai.io`
- [ ] `qa@portalsai.io`

## 5 — Turn on DKIM and get the key

- [ ] Workspace console → Apps → Google Workspace → Gmail → **Authenticate email**.
- [ ] Generate the key for `portalsai.io` (2048-bit if offered). Google shows a TXT value beginning `v=DKIM1; k=rsa; p=…`.
- [ ] Copy the **whole value**. It is longer than 255 characters, so it may need splitting into quoted chunks — Route53 concatenates multiple quoted strings inside one record value.

> **It is a TXT record, not a CNAME.** The CNAME form is Microsoft 365's. A CNAME here deploys cleanly and silently fails DKIM validation.

## 6 — Publish DKIM

- [ ] Re-deploy the stack with the key:

```bash
aws cloudformation deploy \
  --stack-name portalai-dns-email \
  --template-file infra/cloudformation/dns-email.yml \
  --parameter-overrides \
    HostedZoneId=Z0000108E4DFXWIOEOR7 \
    DkimValue='"v=DKIM1; k=rsa; p=<key>"' \
  --no-fail-on-empty-changeset
```

- [ ] `DkimConfigured` output now reads `"true"`.
- [ ] Back in the Workspace console, click **Start authentication**.
- [ ] Persist the value for CI so a future deploy does not drop the record: set the repository variable **`PORTALSAI_DKIM_VALUE`** (Settings → Secrets and variables → Actions → Variables) to the same string. `deploy-dev.yml` passes it on every infra deploy; leaving it unset would re-deploy the stack *without* DKIM.

## 7 — Correct the app-dev addresses

The deploy pipeline seeds SSM **create-if-absent** and never overwrites, so the two parameters seeded before this ticket still hold customer-facing addresses. Staging showing `support@` is exactly the leak #369 exists to prevent.

- [ ] Check what is actually set:

```bash
portalops vars get SUPPORT_EMAIL --env app-dev
portalops vars get SALES_EMAIL --env app-dev
portalops vars get ADMIN_EMAIL --env app-dev
```

- [ ] Set any that are not `qa@portalsai.io`:

```bash
portalops vars set SUPPORT_EMAIL qa@portalsai.io --env app-dev --yes
portalops vars set SALES_EMAIL   qa@portalsai.io --env app-dev --yes
portalops vars set ADMIN_EMAIL   qa@portalsai.io --env app-dev --yes
```

Each write fires the site-rebuild dispatch, so the published site picks the value up. **The web app does not** — it bakes addresses at build time and takes the change on its next deploy. That asymmetry is deliberate (#369): the deploy is the dispatch.

## 8 — Verify deliverability

- [ ] Send mail from an outside account to each of `admin@`, `support@`, `sales@`, `qa@portalsai.io`. All four arrive in the `admin@` mailbox.
- [ ] Check the published records resolve:

```bash
dig +short MX portalsai.io
dig +short TXT portalsai.io
dig +short TXT _dmarc.portalsai.io
dig +short TXT google._domainkey.portalsai.io
```

- [ ] Run an external validator (e.g. [mxtoolbox.com](https://mxtoolbox.com) or [dmarcian](https://dmarcian.com/domain-checker/)) and confirm **SPF, DKIM and DMARC all pass**.

---

## Decisions this runbook assumes

- **Receive-only.** Nothing in the product sends mail, and this ticket adds no sender. SPF is `~all` (softfail) rather than `-all` for that reason: with no sender of our own, a hard fail could only punish a legitimate one we forgot about.
- **DMARC starts at `p=none`.** Aggregate reports go to `admin@` from day one, so tightening to `quarantine` later is evidence-based rather than a guess. Revisit after a few weeks of reports.
- **Mail retention is a Workspace policy**, set in the vendor console and not in code. Left at Google's default deliberately — recorded here so it is a decision rather than an oversight.

## If you need to change something later

| Change | How |
|---|---|
| An address (e.g. prod `support@`) | `portalops vars set SUPPORT_EMAIL <addr> --env prod --yes`, then redeploy the app |
| Rotate the DKIM key | Regenerate in the console, re-run step 6 with the new value, update `PORTALSAI_DKIM_VALUE` |
| Tighten DMARC | Re-deploy with `DmarcPolicy=quarantine` (then `reject`), reading reports between steps |
| Add another alias | Workspace console only — no DNS change; aliases need no records |
| A support *team* rather than one inbox | Aliases deliver to a single mailbox. A Google Group is the migration path, and it is a Workspace change, not a DNS one |
