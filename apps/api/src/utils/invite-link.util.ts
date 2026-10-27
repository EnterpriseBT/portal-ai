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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

function isUsableOrigin(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    !LOOPBACK_HOSTS.has(url.hostname) &&
    !url.hostname.endsWith(".localhost")
  );
}

/** The web origin invite links are built on; throws in production when it
 *  isn't a real one. Call it before writing the invitation. */
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

export function inviteUrl(token: string): string {
  return `${inviteLinkBase()}/invitations/accept?token=${token}`;
}
