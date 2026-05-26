/**
 * Smoke / unit test configuration.
 *
 * Tests live under backend/test/**.test.js and intentionally avoid hitting any
 * external service (Mongo, Redis, Firebase, Stripe). Integration tests with
 * those dependencies should be added separately under tests/integration with
 * their own jest project once a test infra is in place.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  collectCoverageFrom: [
    'src/utils/**/*.js',
    'src/middleware/**/*.js',
  ],
  // Smoke tests must run fast — keep the suite under 30s on CI.
  testTimeout: 10000,
  // Reset env between tests so isAdminEmail() etc. see fresh values.
  resetModules: true,
};
