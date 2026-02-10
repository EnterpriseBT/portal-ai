export default {
  // Use ts-jest preset for ESM
  preset: 'ts-jest/presets/default-esm',

  // Set test environment to jsdom for React
  testEnvironment: 'jest-environment-jsdom',

  // Specify root directory
  rootDir: '.',

  // Module paths
  modulePaths: ['<rootDir>/src'],

  // File extensions Jest should look for
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // Transform files with ts-jest
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json',
      },
    ],
  },

  // Treat these extensions as ESM
  extensionsToTreatAsEsm: ['.ts', '.tsx'],

  // Module name mapper for path aliases and static assets
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '\\.svg$': '<rootDir>/src/__tests__/__mocks__/svgMock.js',
  },

  // Setup files to run after Jest is initialized
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],

  // Test match patterns
  testMatch: [
    '**/__tests__/**/*.test.ts?(x)',
    '**/?(*.)+(spec|test).ts?(x)',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
    '!src/index.ts',
  ],

  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,
};
