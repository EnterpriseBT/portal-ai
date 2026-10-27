/**
 * `e2e:auth`'s arguments (#489), parsed apart from the browser run so the
 * refusals are unit-testable.
 */

import { E2eConfigError, resolveTarget, type E2eTarget } from "./target.js";

export interface AuthArgs {
  target: E2eTarget;
  identity?: string;
  /** A role user's first sign-in goes through its invite link, so it joins
   *  the org it was invited to instead of provisioning one of its own. */
  inviteUrl?: string;
}

const argValue = (argv: string[], flag: string): string | undefined => {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
};

export function parseAuthArgs(
  argv: string[],
  env: NodeJS.ProcessEnv
): AuthArgs {
  const envArg = argValue(argv, "--env");
  const target = resolveTarget(envArg ? { ...env, E2E_TARGET: envArg } : env);
  const identity =
    argValue(argv, "--identity") || env.E2E_IDENTITY || undefined;

  const inviteUrl = argValue(argv, "--invite");
  if (inviteUrl !== undefined) {
    // The credential is typed wherever the link leads, so it must be this
    // env's own app.
    const origin = new URL(target.baseUrl).origin;
    let url: URL;
    try {
      url = new URL(inviteUrl);
    } catch {
      throw new E2eConfigError("--invite is not a URL");
    }
    if (url.origin !== origin) {
      throw new E2eConfigError(
        `--invite must be a link on ${origin} (the ${target.name} app)`
      );
    }
    if (url.pathname !== "/invitations/accept") {
      throw new E2eConfigError(
        "--invite must be an invitation link (/invitations/accept?token=…)"
      );
    }
  }
  return { target, identity, inviteUrl };
}
