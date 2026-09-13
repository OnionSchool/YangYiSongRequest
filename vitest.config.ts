import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: 'data/unit-test.sqlite',
    },
  },
  resolve: {
    alias: {
      'nitropack/runtime': path.resolve('tests/mocks/nitropack-runtime.ts'),
    },
  },
});
