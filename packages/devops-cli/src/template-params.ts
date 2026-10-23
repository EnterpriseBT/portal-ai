/**
 * Reading a CloudFormation template's declared parameters without a YAML
 * dependency (#861). Kept apart from `templates.ts`, which touches the
 * filesystem and is mocked in tests; this is pure, so tests run it for real.
 */

/** Whether a template's `Parameters` block declares `key` (a two-space
 *  indented key under it, the layout every template in infra/ uses). */
export function templateDeclaresParameter(body: string, key: string): boolean {
  const block = /^Parameters:\s*\n((?:[ \t].*\n|\s*\n)*)/m.exec(body + "\n");
  if (!block) return false;
  return new RegExp(`^  ${key}:`, "m").test(block[1]);
}
