import jsxA11y from "eslint-plugin-jsx-a11y";

import base from "./eslint.config.js";

/**
 * Accessibility report config (#792, epic #791). Not loaded by `lint`: it
 * runs only through `npm run a11y:lint`, which writes
 * `a11y-results/eslint.json` for `scripts/a11y-inventory.mjs`. Findings
 * don't fail that script; a broken config does. #799 folds these rules into
 * the main config once the area children have fixed every finding.
 *
 * The `components` map tells jsx-a11y which MUI primitives always render a
 * native element. It's deliberately small: a wrong mapping invents findings.
 */
export default [
  ...base,
  {
    files: ["src/**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: jsxA11y.flatConfigs.strict.rules,
    settings: {
      "jsx-a11y": {
        polymorphicPropName: "component",
        components: { Button: "button", IconButton: "button" },
      },
    },
  },
];
