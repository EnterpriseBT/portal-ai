// jest-axe is CommonJS; Jest's ESM mode exposes only its default export.
import jestAxe from "jest-axe";

/**
 * jsdom has no layout or computed colour, and a component rendered on its own
 * sits in no landmark, so these two rules can only report noise here.
 * Contrast is held by `theme-contrast.test.ts` instead. Mirrors
 * `apps/web/src/__tests__/test-utils.tsx`; keep the two lists the same.
 */
export const JSDOM_DISABLED_AXE_RULES = ["color-contrast", "region"] as const;

/**
 * Asserts that `container` has no axe violations (WCAG 2.2 AA and best
 * practice), apart from the rules jsdom can't evaluate and any the caller
 * disables with a reason.
 */
export async function expectNoAxeViolations(
  container: Element,
  options: { disableRules?: readonly string[] } = {}
): Promise<void> {
  const disabled = [
    ...JSDOM_DISABLED_AXE_RULES,
    ...(options.disableRules ?? []),
  ];
  const results = await jestAxe.axe(container, {
    rules: Object.fromEntries(disabled.map((id) => [id, { enabled: false }])),
  });
  // Registered here rather than in setup.ts, so suites that never call
  // this don't load axe-core.
  expect.extend(jestAxe.toHaveNoViolations);
  expect(results).toHaveNoViolations();
}
