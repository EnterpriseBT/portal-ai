import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import astro from "eslint-plugin-astro";
import globals from "globals";

/**
 * Site lint config (#311). Same plugin/parser shape as `apps/web`, plus
 * `eslint-plugin-astro` for `.astro` single-file components.
 *
 * Two distinct environments live in this package: `src/**` is browser/Astro
 * code, `scripts/**` are Node build scripts. They get different globals so
 * neither needs a blanket `no-undef` disable.
 */
export default [
  { ignores: ["dist/**", ".astro/**", "src/styles/tokens.css"] },
  js.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: { ...globals.browser, process: "readonly" },
    },
    plugins: { "@typescript-eslint": typescript },
    rules: {
      ...typescript.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    // Test files run under Jest against the build scripts.
    files: ["**/__tests__/**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: { ...globals.node, ...globals.jest },
    },
    plugins: { "@typescript-eslint": typescript },
    rules: { ...typescript.configs.recommended.rules },
  },
];
