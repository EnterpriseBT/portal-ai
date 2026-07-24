/**
 * Parse-only validation for an agent-generated D3 render program (#269).
 *
 * Constructs `new Function("api", src)` — the *exact* call the sandbox
 * bootstrap makes (`apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js`)
 * — so server-side acceptance cannot diverge from what the frame parses. It
 * **never calls** the function: this catches syntax errors ("doesn't compile")
 * before a block is minted, and is not a security control (that is the #268
 * sandbox boundary). A body with side effects or a `throw` therefore validates
 * `ok: true` — it is not executed here.
 */
export type ValidateResult = { ok: true } | { ok: false; error: string };

export function validateProgram(src: string): ValidateResult {
  try {
    // Construction parses the body without running it.
    new Function("api", src);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
