// Pin the time zone so date tests (including the DST ones) behave the same on every machine and in CI.
process.env.TZ = 'Europe/London';

export default {
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', verbatimModuleSyntax: false, isolatedModules: true } }] },
};
