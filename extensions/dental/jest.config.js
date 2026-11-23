const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
};
