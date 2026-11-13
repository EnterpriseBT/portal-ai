import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  js.configs.recommended,
  // Node-run build scripts (e.g. the residency image's render-config.mjs, #566)
  // execute under bare node, not the browser — give them node globals.
  {
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", ".storybook/**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        process: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
      react: react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/display-name": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  // SDK api modules call hooks inside non-hook-named functions (e.g. sdk.users.getAll)
  {
    files: ["src/api/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // The D3 sandbox bootstrap runs inside the sandboxed iframe (#268):
  // a standalone browser script loaded via `?raw`, not a module.
  {
    files: ["src/modules/D3Widget/utils/sandbox-bootstrap.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
  },
  // Test files configuration
  {
    files: [
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/__tests__/**/*.{ts,tsx,js}",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        test: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
        global: "readonly",
      },
    },
  },
  // Accessibility (#799, epic #791): jsx-a11y's strict rules gate `lint`
  // under --max-warnings 0, like every other rule here. Tests and stories
  // render fixtures, not shipped markup; a component's own test asserts axe
  // on what it renders instead (component-axe.guard.test.ts).
  //
  // The `components` map tells jsx-a11y which MUI primitives always render a
  // native element. It's deliberately small: a wrong mapping invents findings.
  {
    files: ["src/**/*.tsx"],
    ignores: [
      "src/**/__tests__/**",
      "src/**/*.test.tsx",
      "src/**/*.stories.tsx",
      "src/stories/**",
    ],
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
      // A scrollable box is a tab stop so a keyboard can scroll it (WCAG
      // 2.1.1; axe's scrollable-region-focusable), and a named region is
      // the role that carries it (#799: HighlightedCode). Strict allows only
      // tabpanel by default.
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { tags: [], roles: ["tabpanel", "region"], allowExpressionValues: true },
      ],
    },
    settings: {
      "jsx-a11y": {
        polymorphicPropName: "component",
        components: { Button: "button", IconButton: "button" },
      },
    },
  },
  {
    ignores: [
      "dist/**",
      "storybook-static/**",
      "node_modules/**",
      "*.config.js",
      "*.config.ts",
      "**/*.d.ts",
      // Static assets served verbatim — not source. config.js is the runtime
      // config default (#566), regenerated per-container in the residency image.
      "public/**",
    ],
  },
];
