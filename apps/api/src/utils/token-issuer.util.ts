/**
 * The verified access token's `iss` claim, for `Auth0Service.getAuth0UserProfile`
 * (#950). `undefined` means no claim, which that call reads as the default Auth0
 * issuer. A non-Auth0 issuer (an OIDC install's Keycloak, a federated
 * enterprise IdP, #577) must reach it, or the profile is fetched from
 * `https://${AUTH0_DOMAIN}/userinfo`, which on an OIDC install is
 * `https://undefined/userinfo`.
 *
 * Its own module, not a static on `Auth0Service`, so the many tests that mock
 * that service wholesale still read a real claim.
 */
export function tokenIssuer(req: {
  auth?: { payload: { iss?: unknown } };
}): string | undefined {
  const iss = req.auth?.payload.iss;
  return typeof iss === "string" ? iss : undefined;
}
