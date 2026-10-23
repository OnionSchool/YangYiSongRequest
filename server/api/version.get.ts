import { defineEventHandler, setHeader } from 'h3';

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  return {
    version: process.env.BUILD_VERSION ?? process.env.npm_package_version ?? '0.1.0',
    serverTime: new Date().toISOString(),
  };
});
