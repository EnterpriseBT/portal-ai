/**
 * Flag parsing for the operator scripts the admin CLI spawns (#1035).
 *
 * Reads argv strictly as `--flag value` pairs, so a value is never mistaken
 * for a flag: `--name --tier` names an org "--tier" rather than shadowing
 * the real `--tier`. (The scripts used to look flags up with `indexOf`, which
 * did exactly that.) An unknown flag, a flag without a value or a stray
 * positional argument is an error rather than something silently ignored.
 */

export type ParsedFlags<F extends string> =
  | { ok: true; flags: Partial<Record<F, string>> }
  | { ok: false; error: string };

export function parseFlags<F extends string>(
  argv: string[],
  allowed: readonly F[]
): ParsedFlags<F> {
  const flags: Partial<Record<F, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag.startsWith("--")) {
      return { ok: false, error: `unexpected argument "${flag}"` };
    }
    const name = flag.slice(2) as F;
    if (!allowed.includes(name)) {
      return { ok: false, error: `unknown flag ${flag}` };
    }
    if (i + 1 >= argv.length) {
      return { ok: false, error: `${flag} needs a value` };
    }
    flags[name] = argv[i + 1];
  }
  return { ok: true, flags };
}
