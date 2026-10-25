/**
 * The controls the public `/security/` page describes (#613).
 *
 * Accuracy over aspiration: a control is listed only once it has shipped, and
 * its claim says no more than the code does. `evidence` names the setting
 * each claim rests on — a repo path and a string that must stay in it, never
 * rendered — and `security-controls.test.ts` fails when one goes, so a
 * control can't quietly disappear (or weaken) from under a public claim.
 * Widen a claim only once it holds in every environment: the cache joined
 * both encryption claims (#858) after #852's cutover reached prod.
 */

export interface SecurityControl {
  /** Stable, anchor-safe: `/security/#<id>` links survive copy edits. */
  id: string;
  title: string;
  claim: string;
  /** The settings the claim rests on. Never rendered. */
  evidence: readonly Evidence[];
}

export interface Evidence {
  /** Repo-root-relative. */
  path: string;
  /** Text that must stay in it for the claim to hold — the setting itself. */
  contains: string;
}

export const SECURITY_CONTROLS: readonly SecurityControl[] = [
  {
    id: "encryption-in-transit",
    title: "Encryption in transit",
    claim:
      "Every connection to the Service uses HTTPS. Our web front ends require TLS 1.2 or later and redirect plain HTTP to HTTPS, and the app and API send HTTP Strict Transport Security headers. Inside our network, the API reaches its cache over TLS, and the cache refuses unencrypted connections.",
    evidence: [
      {
        path: "infra/cloudformation/site.yml",
        contains: "MinimumProtocolVersion: TLSv1.2_2021",
      },
      {
        path: "infra/cloudformation/site.yml",
        contains: "StrictTransportSecurity",
      },
      {
        path: "infra/cloudformation/frontend.yml",
        contains: "MinimumProtocolVersion: TLSv1.2_2021",
      },
      {
        path: "infra/cloudformation/frontend.yml",
        contains: "ViewerProtocolPolicy: redirect-to-https",
      },
      { path: "infra/cloudformation/backend.yml", contains: "Protocol: HTTPS" },
      { path: "apps/api/src/app.ts", contains: "helmet(" },
      {
        path: "infra/cloudformation/cache.yml",
        contains: "TransitEncryptionEnabled: true",
      },
      {
        path: "infra/cloudformation/cache.yml",
        contains: "TransitEncryptionMode: required",
      },
      {
        path: "infra/cloudformation/backend.yml",
        contains: '"rediss://${Endpoint}:${Port}"',
      },
    ],
  },
  {
    id: "encryption-at-rest",
    title: "Encryption at rest",
    claim:
      "Our database, cache, file storage and logs are encrypted at rest. Credentials you grant to connectors are additionally encrypted by the application with AES-256-GCM before they are stored.",
    evidence: [
      {
        path: "infra/cloudformation/database.yml",
        contains: "StorageEncrypted: true",
      },
      {
        path: "infra/cloudformation/backend.yml",
        contains: "SSEAlgorithm: AES256",
      },
      { path: "infra/cloudformation/backend.yml", contains: "KmsKeyId" },
      {
        path: "infra/cloudformation/cache.yml",
        contains: "AtRestEncryptionEnabled: true",
      },
      { path: "apps/api/src/utils/crypto.util.ts", contains: '"aes-256-gcm"' },
    ],
  },
  {
    id: "hosting",
    title: "Hosting",
    claim:
      "The Service runs on Amazon Web Services in the United States (us-east-1). The database sits in a private network and is not reachable from the internet.",
    evidence: [
      {
        path: "infra/cloudformation/database.yml",
        contains: "PubliclyAccessible: false",
      },
      { path: ".github/workflows/deploy-prod.yml", contains: "us-east-1" },
    ],
  },
  {
    id: "backups",
    title: "Backups",
    claim:
      "The production database is backed up automatically, with backups kept for 14 days, and is protected against accidental deletion.",
    evidence: [
      {
        path: ".github/workflows/deploy-prod.yml",
        contains: "BackupRetentionPeriod=14",
      },
      {
        path: ".github/workflows/deploy-prod.yml",
        contains: "DeletionProtection=true",
      },
    ],
  },
  {
    id: "sign-in",
    title: "Sign-in and single sign-on",
    claim:
      "Sign-in runs through Auth0, our identity provider. Enterprise customers can sign in through their own OpenID Connect identity provider.",
    evidence: [
      {
        path: "apps/api/src/middleware/auth.middleware.ts",
        contains: "SsoConfig",
      },
      { path: "docs/ENTERPRISE_SSO.runbook.md", contains: "OIDC" },
    ],
  },
  {
    id: "access-control",
    title: "Access control",
    claim:
      "Permissions are defined by roles and policies your organization controls, can be granted on individual objects, and are checked by the server on every request — hiding a button is never what protects your data.",
    evidence: [
      {
        path: "apps/api/src/middleware/require-permission.middleware.ts",
        contains: "PermissionSet",
      },
      {
        path: "apps/api/src/__tests__/config/route-authorization.map.ts",
        contains: "ROUTE_AUTHORIZATION",
      },
    ],
  },
  {
    id: "tenant-isolation",
    title: "Tenant isolation",
    claim:
      "Every request is scoped to your organization, and an object you can't read answers as if it doesn't exist. Queries the AI agent runs execute under a restricted database role that can reach only the views your access allows.",
    evidence: [
      {
        path: "apps/api/src/__tests__/config/route-authorization.map.ts",
        contains: "ROUTE_AUTHORIZATION",
      },
      {
        path: "apps/api/src/services/portal-sql-reader-role.service.ts",
        contains: "NOLOGIN",
      },
    ],
  },
  {
    id: "audit-log",
    title: "Audit log",
    claim:
      "Security-relevant activity in your organization, including sign-ins, changes to members, roles and access, and data deletions, is recorded in an audit log.",
    evidence: [
      {
        path: "apps/api/src/services/audit.service.ts",
        contains: "AuditService",
      },
      {
        path: "apps/api/src/services/application.service.ts",
        contains: '"auth.login"',
      },
      {
        path: "apps/api/src/services/seat.service.ts",
        contains: '"member.role.add"',
      },
      {
        path: "apps/api/src/services/grant.service.ts",
        contains: '"grant.create"',
      },
      {
        path: "apps/api/src/routes/connector-entity.router.ts",
        contains: '"data.delete"',
      },
    ],
  },
  {
    id: "rate-limiting",
    title: "Rate limiting",
    claim: "Authenticated API requests are rate-limited per user.",
    evidence: [
      {
        path: "apps/api/src/middleware/authenticated-rate-limit.middleware.ts",
        contains: "authenticatedRateLimit",
      },
    ],
  },
  {
    id: "vulnerability-management",
    title: "Vulnerability management",
    claim:
      "Every release of our server image is scanned before it ships, and a release with a fixable critical or high-severity vulnerability is blocked. Released images are signed and carry a software bill of materials. The server runs as an unprivileged user.",
    evidence: [
      { path: "docs/SUPPLY_CHAIN.md", contains: "--severity CRITICAL,HIGH" },
      { path: "docs/SUPPLY_CHAIN.md", contains: "sbom: true" },
      { path: "docs/SUPPLY_CHAIN.md", contains: "cosign" },
      { path: "apps/api/Dockerfile", contains: "USER node" },
    ],
  },
];

/**
 * Phrases no rendered sentence may contain (case-insensitive) — each is an
 * overclaim discovery found or a promise the code can't back today.
 */
export const FORBIDDEN_CLAIMS: readonly string[] = [
  "zero retention",
  "zero-retention",
  "zero data retention",
  "SOC 2",
  "ISO 27001",
  "certified",
  "disaster recovery",
  "multi-AZ",
  "multi-region",
  "military-grade",
  "per-organization rate",
];
