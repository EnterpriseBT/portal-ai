import base from "./jest.config.js";

/**
 * Stories accessibility sweep (#792). Runs only `src/__tests__/__a11y__`,
 * which the main config's testMatch never reaches, so `test:unit` is
 * unaffected. `npm run a11y:stories` writes `a11y-results/stories.json`.
 */
export default {
  ...base,
  testMatch: ["<rootDir>/src/__tests__/__a11y__/**/*.a11y.tsx"],
  collectCoverage: false,
  // One test walks every story; axe takes a while per render.
  testTimeout: 30 * 60_000,
  moduleNameMapper: {
    "\\.s?css$": "<rootDir>/src/__tests__/__a11y__/styleMock.js",
    ...base.moduleNameMapper,
  },
};
