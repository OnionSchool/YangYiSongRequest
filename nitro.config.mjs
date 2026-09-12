import { defineNitroConfig } from 'nitropack/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNitroConfig({
  devServer: {
    port: 3001,
    origin: 'http://localhost:3001',
  },
  alias: {
    '~': resolve(currentDir, './server'),
  },
  errorHandler: resolve(currentDir, './server/error-handler.ts'),
});
