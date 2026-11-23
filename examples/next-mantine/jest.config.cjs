const nextJest = require('next/jest');
// Lowest CPU and IO priority, however this run was started. See scripts/lower-priority.cjs.
require('../../scripts/lower-priority.cjs').lowerPriority();

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  moduleNameMapper: {
    '^@/components/(.*)$': '<rootDir>/components/$1',
    '^@/pages/(.*)$': '<rootDir>/pages/$1',
    // The Talkie packages publish ES modules only, so Jest reads their source.
    '^@talkie/(react|player)$': '<rootDir>/../../packages/$1/src/index.ts',
  },
  testEnvironment: 'jest-environment-jsdom',
};

module.exports = createJestConfig(customJestConfig);
