# AWS Marketplace — operator runbook

How to list the residency install on AWS Marketplace and wire its entitlement rail to `organizations.tier` (#568). This is the **console/operator** half; the code half (the adapter, the SNS webhook, the read-only gate) ships in the app.

This is a **durable** reference — it describes the shipped capability, not a point-in-time decision, so it is kept in sync with the app (unlike the swept `.discovery`/`.spec`/`.plan` docs).

## How the rail works

```
AWS Marketplace subscribe / change / expire
        │  (SNS notification, X.509-signed)
        ▼
POST /api/webhooks/aws-marketplace   ── verify signature (sns-validator)
        │                                └─ SubscriptionConfirmation → GET SubscribeURL
        ▼  Notification
TierGrantService.apply(new AwsMarketplaceGrantSource(), { MessageId, … })
        │  converge-read: MarketplaceService.getEntitlement()  (GetEntitlements)
        │  → dimensionToTier → #230-analog foreign guard → org tier + term write
        ▼
organizations.tier = "enterprise", entitlement_through = <term end>
        │
        ▼  (subsequent requests)
requireOrgWritable  ── term in the past ⇒ 403 on writes, reads always pass
```

- **Idempotent** on the SNS `MessageId` via `commercial_events (source, external_id)`; a redelivery is a single row + `duplicate`.
- **Converge-read** is the source of truth (not the notification payload), so out-of-order / duplicate SNS is safe.
- **Flat contract, no metering** — the dimension maps to the all-unlimited `enterprise` tier; the app never self-meters (enforcement fails open on a customer-owned DB).
- **Expiry degrades to read-only, never data loss** — the tier is left intact; only writes stop until renewal.

## One-time listing setup (AWS console / seller account)

1. **Create the product** — AWS Marketplace Management Portal → a **Container (EKS)** product built on the L2 Helm chart (#566).
2. **Pricing** — a **Contract** (entitlement) dimension, flat/unlimited. **Name the dimension `enterprise`** — `MarketplaceService.dimensionToTier` maps it to the `enterprise` tier. (To add SKUs later, extend `DIMENSION_TO_TIER` in `marketplace.service.ts`.)
3. **Note the Product Code** — the listing's product code (e.g. `abcd1234…`). This is `AWS_MARKETPLACE_PRODUCT_CODE`.
4. **Entitlement notifications** — the product's SNS topic (in **us-east-1**) publishes entitlement-change notifications. Subscribe the install's webhook URL:
   - Protocol **HTTPS**, endpoint `https://<install-host>/api/webhooks/aws-marketplace`.
   - The install auto-confirms the `SubscriptionConfirmation` (it GETs the `SubscribeURL`).

## Install configuration (Helm values / env)

Set on the residency install (see `deploy/helm/portalai`):

| Env | Value |
|---|---|
| `AWS_MARKETPLACE_PRODUCT_CODE` | the listing's product code (enables the rail; unset ⇒ the webhook 404s) |
| `AWS_MARKETPLACE_REGION` | `us-east-1` (the Entitlement Service is only there) |
| AWS credentials | the SDK credential chain (task role / `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY`) with `aws-marketplace:GetEntitlements` for the product |

The install runs **in the customer's AWS account**, so `GetEntitlements(ProductCode)` returns that customer's entitlement. Residency is single-tenant — the grant targets the install's sole org (`OrganizationsRepository.findSole`).

## Verifying (test-account subscription)

1. Subscribe a **test AWS account** to the listing → an SNS `Notification` hits the webhook → the org resolves to `tier = "enterprise"` with a future `entitlement_through` (inspect via `db:studio` → `organizations`).
2. A mutating request succeeds; a `commercial_events` row exists with `source = 'aws_marketplace'`, `outcome = 'applied'`.
3. **Redeliver** the same SNS message → a single `commercial_events` row, `apply` returns `duplicate`.
4. **Expire** the test entitlement → the next notification sets `entitlement_through` to now; mutating requests 403 `ORG_ENTITLEMENT_EXPIRED`, reads still 200. **Renew** → writes restored.
5. **No Stripe object** is touched for the marketplace-granted org (`StripeService.isConfigured()` may be false).

## Notes / gotchas

- **Dimension name is a contract** — it must match `DIMENSION_TO_TIER` (`enterprise`); an unknown dimension throws (the SNS delivery 500s and AWS retries) rather than silently mis-granting.
- **Signature verification is mandatory** — a forged/malformed SNS body is rejected 400 `MARKETPLACE_SIGNATURE_INVALID`; never disable it.
- **us-east-1 only** for the Entitlement/Metering services, regardless of where the install runs.
- **GCP / Azure** marketplaces reuse the same `TierGrantSource` seam — a new adapter + listing, no call-site changes.
