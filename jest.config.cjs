module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src","<rootDir>/electron"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@core/(.*)$": "<rootDir>/src/core/$1",
    "^@shared/(.*)$": "<rootDir>/src/shared/$1"
  }
};