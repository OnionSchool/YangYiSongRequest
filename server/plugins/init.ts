/**
 * Server initialization plugin - runs on server startup
 */

export default defineNitroPlugin(async () => {
  console.log('[Nitro] Starting initialization...');

  const { initializeDatabase } = await import('../utils/init-db');
  await initializeDatabase();

  console.log('[Nitro] Initialization complete');
});
