/**
 * The API's externally-reachable URLs (#382, #889, #891).
 *
 * Two settings default to loopback, which is right for local dev and wrong
 * anywhere else:
 * - `WEB_APP_URL`: invite links are built on it (#889 refuses an invite in
 *   production rather than hand out a localhost link).
 * - `PUBLIC_API_BASE_URL`: the address a webhook toolpack's runtime calls
 *   back on to pull streamed input or stage a large result. Only those tools
 *   need it; plain webhook tools and the rest of the app never use it.
 *
 * A missing value doesn't stop the API: an install that never uses those
 * features shouldn't be blocked over them. Instead it's named at install
 * (Helm NOTES), at startup (a warning per setting) and at use (the invite or
 * webhook tool refuses, saying why).
 */

export type PublicUrlSetting = "WEB_APP_URL" | "PUBLIC_API_BASE_URL";

/** A hostname as `new URL()` normalizes it (lowercase, IPv4 in dotted
 *  decimal, IPv6 bracketed and compressed). */
function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "[::1]" ||
    host === "[::]" ||
    // IPv4-mapped 127.0.0.0/8, e.g. [::ffff:127.0.0.1] → [::ffff:7f00:1].
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host)
  );
}

/** An `http(s)` origin someone else can reach: parses, and isn't loopback. */
export function isPublicOrigin(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    !isLoopback(url.hostname)
  );
}

/** What each setting's absence breaks, in the installer's terms. The same
 *  sentences appear in the Helm NOTES. */
export const PUBLIC_URL_CONSEQUENCES: Record<PublicUrlSetting, string> = {
  WEB_APP_URL: "Invitations are refused until it is.",
  PUBLIC_API_BASE_URL:
    "Webhook tools that stream data in or return large results need it to call back, and will refuse until it's set. Plain webhook tools and the rest of the app don't need it.",
};

export interface PublicUrlWarning {
  setting: PublicUrlSetting;
  value: string;
  message: string;
}

/** One warning per setting that isn't a public origin, in production only. */
export function publicUrlWarnings(env: {
  NODE_ENV: string;
  WEB_APP_URL: string;
  PUBLIC_API_BASE_URL: string;
}): PublicUrlWarning[] {
  if (env.NODE_ENV !== "production") return [];
  return (["WEB_APP_URL", "PUBLIC_API_BASE_URL"] as const)
    .filter((setting) => !isPublicOrigin(env[setting]))
    .map((setting) => ({
      setting,
      value: env[setting],
      message: `${setting} isn't set to a public URL (it's "${env[setting]}"). ${PUBLIC_URL_CONSEQUENCES[setting]}`,
    }));
}
