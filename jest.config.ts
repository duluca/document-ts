/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testPathIgnorePatterns: ['.d.ts', '.js'],
  // All imported modules in your tests should be mocked automatically
  // automock: false,
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/'],
  // Istanbul maps ts-jest branches back to TypeScript accurately; the V8
  // provider reports generated async state-machine branches as uncovered.
  coverageProvider: 'babel',
  // Prefer TypeScript if a developer has stale JavaScript from the old
  // build:test workflow, which used to emit beside the source files.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  coverageThreshold: {
    global: {
      branches: 78,
      lines: 90,
      functions: 88,
      statements: 90,
    },
  },

  testEnvironment: 'node',
  testTimeout: 10000,
}

export default config
