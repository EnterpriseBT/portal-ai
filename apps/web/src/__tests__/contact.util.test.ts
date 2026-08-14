/**
 * Business contact addresses in the app (#369).
 *
 * The bug this replaced was a personal address on an unrelated domain
 * (`mailto:ben.turner@btdev.io`) hardcoded in `tier-format.util.ts` and
 * rendered to paying customers — `apps/web` was never wired to the contact
 * config when #311 introduced it, so a constant grew beside it.
 *
 * Addresses are env-derived now: SSM is the single place a value is written
 * and the deploy bakes it into the bundle as a `VITE_*` var. `import.meta.env`
 * is Vite-only and per-module, so the resolution is tested as the pure
 * function it was factored into; the exported constants are asserted for the
 * properties that must hold however the environment resolves.
 */
import {
  QA_EMAIL,
  resolveEmail,
  SUPPORT_EMAIL,
  SALES_EMAIL,
  SUPPORT_MAILTO,
  SALES_MAILTO,
} from "../utils/contact.util";

describe("resolveEmail (#369)", () => {
  it("uses a configured address", () => {
    expect(resolveEmail("support@portalsai.io")).toBe("support@portalsai.io");
  });

  it("falls back to the QA inbox when unset", () => {
    // With the API's runtime contact read gone, an unset value can no longer
    // fail closed. An address we own still delivers mail; an empty `mailto:`
    // is a dead link in front of a customer.
    expect(resolveEmail(undefined)).toBe(QA_EMAIL);
  });

  it("treats blank and whitespace-only values as unset", () => {
    expect(resolveEmail("")).toBe(QA_EMAIL);
    expect(resolveEmail("   ")).toBe(QA_EMAIL);
  });

  it("trims a stray newline from a pasted parameter value", () => {
    // SSM values pasted by hand pick these up; a newline inside a `mailto:`
    // href is silently broken.
    expect(resolveEmail("support@portalsai.io\n")).toBe("support@portalsai.io");
  });
});

describe("contact addresses (#369)", () => {
  it("never advertises an address outside portalsai.io", () => {
    // The regression guard for the bug itself: a personal address on an
    // unrelated domain rendered to customers.
    for (const address of [SUPPORT_EMAIL, SALES_EMAIL]) {
      expect(address.endsWith("@portalsai.io")).toBe(true);
    }
  });

  it("never produces a bare mailto:", () => {
    for (const href of [SUPPORT_MAILTO, SALES_MAILTO]) {
      expect(href.startsWith("mailto:")).toBe(true);
      expect(href).not.toBe("mailto:");
    }
  });

  it("imports cleanly outside a Vite build", () => {
    // `import.meta.env` does not exist under jest; the module must still
    // resolve rather than throwing on property access.
    expect(SUPPORT_EMAIL).toBe(QA_EMAIL);
    expect(SALES_EMAIL).toBe(QA_EMAIL);
  });
});
