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
    // Tests and stories render fixtures, not shipped markup; the stories
    // sweep (a11y:stories) audits what the stories render instead.
    ignores: ["src/**/__tests__/**", "src/**/*.test.tsx", "src/**/*.stories.tsx", "src/stories/**"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      // A form's onKeyDown is #789's Enter-submit delegation
      // (`preventToggleEnterSubmit`): it keeps Enter on a checkbox or radio
      // from submitting, and the form itself is never the key's target
      // (#795). Strict's own element allowances are kept.
      "jsx-a11y/no-noninteractive-element-interactions": [
        "error",
        {
          ...jsxA11y.flatConfigs.strict.rules[
            "jsx-a11y/no-noninteractive-element-interactions"
          ][1],
          form: ["onKeyDown"],
        },
      ],
    },
    settings: {
      "jsx-a11y": {
        polymorphicPropName: "component",
        components: { Button: "button", IconButton: "button" },
      },
    },
  },
];
