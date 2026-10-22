/**
 * The controls the public `/security/` page describes (#613).
 *
 * Accuracy over aspiration: a control is listed only once it has shipped, and
 * its claim says no more than the code does. `evidence` names the repo paths
 * each claim rests on — never rendered — and `security-controls.test.ts`
 * fails when one is deleted, so a control can't quietly disappear from under
 * a public claim. Widen a claim only alongside the change that makes it true
 * (e.g. ElastiCache encryption, #852).
 */

export interface SecurityControl {
  /** Stable, anchor-safe: `/security/#<id>` links survive copy edits. */
  id: string;
  title: string;
  claim: string;
  /** Repo-root-relative paths the claim rests on. Never rendered. */
  evidence: readonly string[];
}

export const SECURITY_CONTROLS: readonly SecurityControl[] = [
  {
    id: "encryption-in-transit",
    title: "Encryption in transit",
    claim:
      "Every connection to the Service uses HTTPS. Our web front ends require TLS 1.2 or later and redirect plain HTTP to HTTPS, and the app and API send HTTP Strict Transport Security headers.",
    evidence: [
      "infra/cloudformation/site.yml",
      "infra/cloudformation/frontend.yml",
      "infra/cloudformation/backend.yml",
      "apps/api/src/app.ts",
    ],
  },
  {
    id: "encryption-at-rest",
    title: "Encryption at rest",
    claim:
      "Our database, file storage and logs are encrypted at rest. Credentials you grant to connectors are additionally encrypted by the application with AES-256-GCM before they are stored.",
    evidence: [
      "infra/cloudformation/database.yml",
      "infra/cloudformation/backend.yml",
      "apps/api/src/utils/crypto.util.ts",
    ],
  },
  {
    id: "hosting",
    title: "Hosting",
    claim:
      "The Service runs on Amazon Web Services in the United States (us-east-1). The database sits in a private network and is not reachable from the internet.",
    evidence: [
      "infra/cloudformation/database.yml",
      ".github/workflows/deploy-prod.yml",
    ],
  },
  {
    id: "backups",
    title: "Backups",
    claim:
      "The production database is backed up automatically, with backups kept for 14 days, and is protected against accidental deletion.",
    evidence: [".github/workflows/deploy-prod.yml"],
  },
  {
    id: "sign-in",
    title: "Sign-in and single sign-on",
    claim:
      "Sign-in runs through Auth0, our identity provider. Enterprise customers can sign in through their own OpenID Connect identity provider.",
    evidence: [
      "apps/api/src/middleware/auth.middleware.ts",
      "docs/ENTERPRISE_SSO.runbook.md",
    ],
  },
  {
    id: "access-control",
    title: "Access control",
    claim:
      "Permissions are defined by roles and policies your organization controls, can be granted on individual objects, and are checked by the server on every request — hiding a button is never what protects your data.",
    evidence: [
      "apps/api/src/middleware/require-permission.middleware.ts",
      "apps/api/src/__tests__/config/route-authorization.map.ts",
    ],
  },
  {
    id: "tenant-isolation",
    title: "Tenant isolation",
    claim:
      "Every request is scoped to your organization, and an object you can't read answers as if it doesn't exist. Queries the AI agent runs execute under a restricted database role that can reach only the views your access allows.",
    evidence: [
      "apps/api/src/__tests__/config/route-authorization.map.ts",
      "apps/api/src/services/portal-sql-reader-role.service.ts",
    ],
  },
  {
    id: "audit-log",
    title: "Audit log",
    claim:
      "Security-relevant activity in your organization, including sign-ins, changes to members, roles and access, and data deletions, is recorded in an audit log.",
    evidence: ["apps/api/src/services/audit.service.ts"],
  },
  {
    id: "rate-limiting",
    title: "Rate limiting",
    claim: "Authenticated API requests are rate-limited per user.",
    evidence: [
      "apps/api/src/middleware/authenticated-rate-limit.middleware.ts",
    ],
  },
  {
    id: "vulnerability-management",
    title: "Vulnerability management",
    claim:
      "Every release of our server image is scanned before it ships, and a release with a fixable critical or high-severity vulnerability is blocked. Released images are signed and carry a software bill of materials. The server runs as an unprivileged user.",
    evidence: ["docs/SUPPLY_CHAIN.md", "apps/api/Dockerfile"],
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
  "Redis",
  "military-grade",
  "per-organization rate",
];
