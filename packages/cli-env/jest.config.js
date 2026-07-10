export default {
  // ts-jest ESM preset — same toolchain as packages/core, minus the DOM.
  preset: "ts-jest/presets/default-esm",

  // Node-only package: no jsdom.
  testEnvironment: "node",

  rootDir: ".",
  modulePaths: ["<rootDir>/src"],
  moduleFileExtensions: ["ts", "js", "json"],

  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.json",
      },
    ],
  },

  extensionsToTreatAsEsm: [".ts"],

  // Map NodeNext-style `./x.js` specifiers back to their .ts sources.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },

  testMatch: ["<rootDir>/src/__tests__/**/*.test.ts"],
};
