export default {
  // Use ts-jest preset for ESM
  preset: "ts-jest/presets/default-esm",

  // Node test environment for database integration tests
  testEnvironment: "node",

  // Root directory
  rootDir: ".",

  // File extensions
  moduleFileExtensions: ["ts", "js", "json"],

  // Transform TypeScript files with ts-jest
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.json",
      },
    ],
  },

  // Treat .ts files as ESM
  extensionsToTreatAsEsm: [".ts"],

  // Map .js imports back to .ts source files
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@portalai/core$": "<rootDir>/../../packages/core/src/index.ts",
    "^@portalai/core/(.*)$": "<rootDir>/../../packages/core/src/$1/index.ts",
  },

  // Test file patterns - only integration tests
  testMatch: [
    "<rootDir>/src/**/__tests__/__integration__/**/*.integration.test.ts",
  ],

  // Setup file run before tests - this will spin up postgres
  globalSetup: "<rootDir>/src/__tests__/__integration__/setup.ts",
  globalTeardown: "<rootDir>/src/__tests__/__integration__/teardown.ts",

  // Coverage configuration
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
    "!src/types/**",
    "!src/**/__tests__/**",
    "!src/scripts/**",
  ],

  coverageDirectory: "coverage-integration",

  coverageReporters: ["text", "lcov", "clover"],

  // Don't silence logs for integration tests (helpful for debugging)
  silent: false,

  // Increase timeout for integration tests
  testTimeout: 60000,

  // Force Jest to exit after all tests complete.
  // Integration tests open module-level handles (postgres connections,
  // Redis/BullMQ connections) that live in per-test VM contexts.
  // globalTeardown runs in its own context and cannot close them,
  // so without this flag Jest hangs indefinitely.
  forceExit: true,
};
