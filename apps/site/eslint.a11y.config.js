import astro from "eslint-plugin-astro";

import base from "./eslint.config.js";

/**
 * Accessibility report config (#792, epic #791). Not loaded by `lint`: it
 * runs only through `npm run a11y:lint`, which writes
 * `a11y-results/eslint.json` for `scripts/a11y-inventory.mjs`.
 * eslint-plugin-astro's preset applies jsx-a11y's strict rules to `.astro`
 * files under the `astro/jsx-a11y/` prefix. #799 folds it into the main
 * config once #798 has fixed every finding.
 */
export default [...base, ...astro.configs["flat/jsx-a11y-strict"]];
