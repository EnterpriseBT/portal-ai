/**
 * A fresh toolpack signing secret (#911), in the API's format: `whsec_` +
 * 32 bytes from `crypto.getRandomValues`, base64url without padding (43
 * characters). The register dialog generates it so the builder can set it on
 * their server before registering, and the server can verify every request.
 */
export function generateSigningSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  const base64url = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `whsec_${base64url}`;
}
