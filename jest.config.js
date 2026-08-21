/** Unit tests only - these run with no database, so they can gate CI. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Decorator metadata is emitted below, but nothing reads it until the
  // polyfill is loaded. Without this, importing any DTO from a spec fails with
  // "Reflect.getMetadata is not a function" - which looks like a broken test
  // rather than a missing global.
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          target: 'ES2023',
          module: 'commonjs',
          strictPropertyInitialization: false,
        },
      },
    ],
  },
  testEnvironment: 'node',
};
