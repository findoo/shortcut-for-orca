export default {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', verbatimModuleSyntax: false, isolatedModules: true } }] },
};
