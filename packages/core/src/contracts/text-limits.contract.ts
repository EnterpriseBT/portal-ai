import { z } from "zod";

import type { LayoutPlan } from "./spreadsheet-parsing.contract.js";

/**
 * Length limits on user-authored text (#801). Request contracts compose the
 * builders below rather than spelling `.max()` inline, so the API's 400, the
 * web's inline error and `name-length.guard.test.ts` all read one rule.
 *
 * The limits go on request contracts only, never on models or on
 * `LayoutPlanSchema`: those parse stored rows and replayed plans, and an
 * over-length value written before the limit must stay readable.
 */

/** Names, labels and titles. */
export const NAME_MAX_LENGTH = 120;
/** Descriptions and validation messages (the same bound as `promptHint`). */
export const DESCRIPTION_MAX_LENGTH = 2000;
/** Keys that become `c_<key>` Postgres identifiers: 63 − "c_" − "_NN". */
export const KEY_MAX_LENGTH = 58;
/** Postgres's identifier limit (NAMEDATALEN − 1), in bytes. */
export const PG_IDENTIFIER_MAX_BYTES = 63;

export const tooLongMessage = (field: string, max: number): string =>
  `${field} must be ${max} characters or fewer`;

/** Trimmed, required, at most `NAME_MAX_LENGTH`. */
export const nameField = (field = "Name") =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(NAME_MAX_LENGTH, tooLongMessage(field, NAME_MAX_LENGTH));

/** At most `DESCRIPTION_MAX_LENGTH`, untrimmed. Callers add `.optional()` /
 *  `.nullable()`. */
export const descriptionField = (field = "Description") =>
  z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, tooLongMessage(field, DESCRIPTION_MAX_LENGTH));

/** At most `KEY_MAX_LENGTH`. Callers compose their pattern after it. */
export const keyField = (field = "Key") =>
  z.string().max(KEY_MAX_LENGTH, tooLongMessage(field, KEY_MAX_LENGTH));

/** For a name we generate ourselves (a provider account label): clip it
 *  rather than reject a connection the user can't fix. */
export const clipToLength = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

export interface TextLimitIssue {
  path: (string | number)[];
  message: string;
}

/**
 * The user-authored text in a layout plan that becomes object fields: a
 * region's `targetEntityDefinitionId` (a new entity's label) and its binding
 * `normalizedKey` overrides. The commit-draft contract and the plan PATCH run
 * this; `LayoutPlanSchema` itself stays unbounded (see the file comment).
 * Paths are relative to the plan.
 */
export function planTextLimitIssues(plan: LayoutPlan): TextLimitIssue[] {
  const issues: TextLimitIssue[] = [];
  plan.regions.forEach((region, r) => {
    if (region.targetEntityDefinitionId.length > NAME_MAX_LENGTH) {
      issues.push({
        path: ["regions", r, "targetEntityDefinitionId"],
        message: tooLongMessage("Entity label", NAME_MAX_LENGTH),
      });
    }
    region.columnBindings.forEach((binding, b) => {
      if ((binding.normalizedKey?.length ?? 0) > KEY_MAX_LENGTH) {
        issues.push({
          path: ["regions", r, "columnBindings", b, "normalizedKey"],
          message: tooLongMessage("Normalized key", KEY_MAX_LENGTH),
        });
      }
    });
  });
  return issues;
}
