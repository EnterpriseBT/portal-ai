/**
 * Unit tests for the site's build-time logic only — `src/lib` (config fetch,
 * formatting) and `scripts` (the token bridge). Astro components are not
 * unit-tested: their contract is the EMITTED HTML, which `verify-pages.mjs`
 * asserts against the real build output. Testing them here would mock away
 * the only thing that matters.
 */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  rootDir: ".",
  moduleFileExtensions: ["ts", "js", "mjs", "json"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.jest.json" }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Resolve core from source: the token bridge and the config parser must
    // be tested against the contract as written, not a stale dist build.
    "^@portalai/core/contracts$":
      "<rootDir>/../../packages/core/src/contracts/index.ts",
    "^@portalai/core/content$":
      "<rootDir>/../../packages/core/src/content/index.ts",
    "^@portalai/core/registries$":
      "<rootDir>/../../packages/core/src/registries/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: [
    "<rootDir>/src/**/__tests__/**/*.test.ts",
    "<rootDir>/scripts/**/__tests__/**/*.test.ts",
  ],
  // Two suites, no I/O worth parallelising. Root `test:unit` runs every
  // package's jest concurrently under turbo, and the extra worker pool this
  // package would otherwise claim was enough to tip `apps/web`'s
  // userEvent-driven tests past their 5s timeout on a loaded machine.
  maxWorkers: 1,
  collectCoverageFrom: ["src/lib/**/*.ts"],
};
