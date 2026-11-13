import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
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
      },
      globals: {
        console: "readonly",
        process: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        // Base64 for the keyset cursor codec (#433). Standard in browsers
        // and in Node since 16 — this package is bundled for both, which is
        // why the codec uses these rather than `Buffer`.
        btoa: "readonly",
        atob: "readonly",
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
  // Test files configuration
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        test: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
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
    rules: jsxA11y.flatConfigs.strict.rules,
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
      "node_modules/**",
      "*.config.js",
      "*.config.ts",
      "**/*.d.ts",
    ],
  },
];
