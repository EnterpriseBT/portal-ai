/**
 * Invite links (#584, #889).
 *
 * The link is `${WEB_APP_URL}/invitations/accept?token=…`. `WEB_APP_URL`
 * defaults to the local web app, and #889 found every deployed env using that
 * default: each invite app-dev and prod handed out pointed at localhost. So in
 * production a loopback or unparsable origin refuses with a 503 the inviter can
 * read, before anything is written, rather than returning a link no invitee can
 * open.
 */

import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { ApiError } from "../services/http.service.js";

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

function isUsableOrigin(raw: string): boolean {
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

/** The web origin invite links are built on; throws in production when it
 *  isn't a real one. Call it once, before writing the invitation. */
export function inviteLinkBase(): string {
  const base = environment.WEB_APP_URL.replace(/\/+$/, "");
  if (environment.NODE_ENV === "production" && !isUsableOrigin(base)) {
    throw new ApiError(
      503,
      ApiCode.INVITATION_LINK_UNCONFIGURED,
      "Invitation links aren't configured on this server"
    );
  }
  return base;
}

export function buildInviteUrl(base: string, token: string): string {
  return `${base}/invitations/accept?token=${token}`;
}
