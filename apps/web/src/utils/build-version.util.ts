/**
 * Resolves the build identity stamped into `version.json` at build time and
 * polled by `useAppVersion` (`app-version.util.ts`) to prompt a reload when a
 * new build is deployed.
 *
 * This is build-time code living under `src/` on purpose: it is imported by
 * `vite.config.ts`, but keeping it here is what puts it inside `apps/web`'s
 * jest `testMatch` with no config change.
 *
 * Why not `crypto.randomUUID()` (what this replaced, #454): that minted a new
 * value per build *invocation*, so rebuilding or redeploying an unchanged
 * commit changed the version and prompted every connected user to reload for
 * a bundle identical to the one they already had.
 *
 * Keying on the commit fixes that and makes the build cacheable in the same
 * stroke — if a cached build is restored, the bundle bytes are identical, so
 * reporting the same version is not a stale answer, it is the correct one.
 * It also means `version.json` and the build stamp the sidebar already renders
 * (`SidebarNav.component.tsx`) are one identity rather than two disagreeing ones.
 */

/** Reported when no commit is available — local dev, where self-prompting is noise. */
const LOCAL_FALLBACK = "dev";

export function resolveBuildVersion(
  env: Record<string, string | undefined>
): string {
  const sha = env.VITE_APP_SHA?.trim();
  return sha ? sha : LOCAL_FALLBACK;
}
