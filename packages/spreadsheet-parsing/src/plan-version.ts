/**
 * Semver identifier for the layout-plan schema. Bumped when the wire shape of
 * `LayoutPlan` changes in a way that old plans cannot be replayed under new
 * code — a new major/minor version triggers replan rather than drift
 * detection. Patch bumps are safe to apply in place.
 */
export const PLAN_VERSION = "1.0.0";
