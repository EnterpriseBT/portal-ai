/**
 * RFC 9116 `security.txt` (#613), rendered by the
 * `src/pages/.well-known/security.txt.ts` endpoint at build time.
 *
 * `Expires` is required by the RFC, and a file past it reads to scanners as
 * abandoned. Computing it from the build time means any site build renews it;
 * the window is short enough (180 days, inside the RFC's "less than a year"
 * advice) that a stale address can't stay authoritative for long.
 *
 * Pure (no `import.meta`, no env reads) so it is unit-testable.
 */

export const SECURITY_TXT_TTL_DAYS = 180;

export interface SecurityTxtInput {
  contactEmail: string;
  siteUrl: string;
  now: Date;
}

export function renderSecurityTxt({
  contactEmail,
  siteUrl,
  now,
}: SecurityTxtInput): string {
  const origin = siteUrl.replace(/\/+$/, "");
  const expires = new Date(now.getTime() + SECURITY_TXT_TTL_DAYS * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  return [
    `Contact: mailto:${contactEmail}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/security/#disclosure`,
    "",
  ].join("\n");
}
