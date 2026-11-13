import base from "./jest.config.js";

/**
 * Stories accessibility sweep (#792). Runs only `src/__tests__/__a11y__`,
 * which the main config's testMatch never reaches, so `test:unit` is
 * unaffected. The sweep is split into shard files that run in parallel
 * workers (#799); the global setup clears old results and the teardown
 * merges the shards into `a11y-results/stories.json`.
 */
export default {
  ...base,
  testMatch: ["<rootDir>/src/__tests__/__a11y__/**/*.a11y.tsx"],
  collectCoverage: false,
  // One worker per core: CI's 4 vCPUs run all four shards at once (the
  // default leaves a core free, which serialises one shard).
  maxWorkers: "100%",
  globalSetup: "<rootDir>/scripts/a11y-stories.setup.mjs",
  globalTeardown: "<rootDir>/scripts/a11y-stories.teardown.mjs",
  // Each shard walks a quarter of the stories; axe takes a while per render.
  testTimeout: 30 * 60_000,
  moduleNameMapper: {
    "\\.s?css$": "<rootDir>/src/__tests__/__mocks__/styleMock.js",
    ...base.moduleNameMapper,
  },
};
