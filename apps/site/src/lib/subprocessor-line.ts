/**
 * One subprocessor as one rendered sentence (#613). The privacy policy and
 * `/security/` both list `SUBPROCESSORS`; formatting it in one place keeps
 * the two pages from wording the same entry differently.
 */
import type { Subprocessor } from "@portalai/core/content";

export const subprocessorLine = (s: Subprocessor): string =>
  s.usedWhen === null
    ? `${s.name}: ${s.purpose}`
    : `${s.name}: ${s.purpose} Used ${s.usedWhen}.`;
