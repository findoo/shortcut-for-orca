export default {
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', verbatimModuleSyntax: false, isolatedModules: true } }] },
};
