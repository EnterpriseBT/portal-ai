/**
 * Deploy-model selector (#577). Mirrors the API's `DEPLOY_MODE`: `saas` is the
 * default (today's Auth0/Google login); `self_hosted` points login at the
 * customer's own IdP via Auth0 Universal Login. Any unrecognized/absent value
 * falls back to `saas`, so an unset build behaves exactly as before.
 */
export type DeployMode = "saas" | "self_hosted";

export function resolveDeployMode(raw: string | undefined): DeployMode {
  return raw === "self_hosted" ? "self_hosted" : "saas";
}
