export default {
  // Use ts-jest preset for ESM
  preset: "ts-jest/presets/default-esm",

  // Set test environment to jsdom for React
  testEnvironment: "jest-environment-jsdom",

  // Specify root directory
  rootDir: ".",

  // Module paths
  modulePaths: ["<rootDir>/src"],

  // File extensions Jest should look for
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],

  // Transform files with ts-jest
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.json",
      },
    ],
  },

  // Treat these extensions as ESM
  extensionsToTreatAsEsm: [".ts", ".tsx"],

  // Module name mapper for path aliases and static assets
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "\\.svg$": "<rootDir>/src/__tests__/__mocks__/svgMock.tsx",
    "\\.css$": "<rootDir>/src/__tests__/__mocks__/styleMock.js",
    // Map @portalai/core to the TypeScript source so ts-jest can transform it
    "^@portalai/core/styles$": "<rootDir>/src/__tests__/__mocks__/styleMock.js",
    "^@portalai/core/ui$": "<rootDir>/../../packages/core/src/ui/index.ts",
    "^@portalai/core/models$": "<rootDir>/../../packages/core/src/models/index.ts",
    "^@portalai/core/contracts$": "<rootDir>/../../packages/core/src/contracts/index.ts",
    "^@portalai/core$": "<rootDir>/../../packages/core/src/index.ts",
    // Force CJS build of uuid (jsdom env resolves to ESM browser build which Jest can't parse)
    "^uuid$": "<rootDir>/../../node_modules/uuid/dist/index.js",
  },

  // Setup files to run after Jest is initialized
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup.ts"],

  // Test match patterns
  testMatch: ["**/__tests__/**/*.test.ts?(x)", "**/?(*.)+(spec|test).ts?(x)"],

  // Coverage configuration
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/__tests__/**",
    "!src/main.tsx",
    "!src/routes.tsx",
    "!src/**/*.stories.tsx",
  ],

  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },

  // Ignore patterns
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/storybook-static/"],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,
};
