/**
 * Compile-time assertions that guarantee the Drizzle table schemas
 * (source of truth) stay in sync with the hand-written Zod model
 * schemas exported from `@mcp-ui/core`.
 *
 * If a column is added/removed/changed in a Drizzle table but the
 * corresponding Zod model in core is not updated (or vice-versa),
 * TypeScript will produce a compile error here — failing CI before
 * the mismatch can reach production.
 *
 * This file produces NO runtime code; it exists purely for the
 * type-checker.
 */

import type { User, Core } from "@mcp-ui/core/models";
import type { UserSelect } from "./zod.js";
import type { InferSelectModel } from "drizzle-orm";
import type { users } from "./users.table.js";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Evaluates to `true` if A is assignable to B, otherwise `never`.
 * Use in both directions for structural equality.
 */
type IsAssignable<A, B> = A extends B ? true : never;

// ── User ────────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _DrizzleToModel = IsAssignable<UserSelect, User>;
const _drizzleToModel: _DrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _ModelToDrizzle = IsAssignable<User, UserSelect>;
const _modelToDrizzle: _ModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _InferredRow = InferSelectModel<typeof users>;
type _InferredToModel = IsAssignable<_InferredRow, User>;
const _inferredToModel: _InferredToModel = true;

// ── Base Model ──────────────────────────────────────────────────────

// Ensure the base audit fields in the Drizzle row satisfy Core.
// We pick only the base keys to avoid failing on entity-specific columns.
type BaseKeys = keyof Core;
type DrizzleBaseFields = Pick<UserSelect, BaseKeys>;

type _DrizzleBaseToModel = IsAssignable<DrizzleBaseFields, Core>;
const _drizzleBaseToModel: _DrizzleBaseToModel = true;

type _ModelToBase = IsAssignable<Core, DrizzleBaseFields>;
const _modelToBase: _ModelToBase = true;
