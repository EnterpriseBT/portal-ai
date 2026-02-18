export default {
  // Use ts-jest preset for ESM
  preset: "ts-jest/presets/default-esm",

  // Node test environment for Express API
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
    "^@mcp-ui/core$": "<rootDir>/../../packages/core/src/index.ts",
    "^@mcp-ui/core/(.*)$": "<rootDir>/../../packages/core/src/$1/index.ts",
  },

  // Test file patterns - exclude integration tests
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/src/__tests__/__integration__/",
  ],

  // Setup file run before tests
  setupFiles: ["<rootDir>/src/__tests__/setup.ts"],

  // Coverage configuration
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
    "!src/types/**",
    "!src/**/__tests__/**",
    "!src/scripts/**",
  ],

  coverageDirectory: "coverage",

  coverageReporters: ["text", "lcov", "clover"],

  // Silence logs during tests
  silent: true,
};
