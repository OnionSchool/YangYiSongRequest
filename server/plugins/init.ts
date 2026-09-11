/**
 * Server initialization plugin - runs on server startup
 */

export default defineNitroPlugin(async () => {
  console.log('[Nitro] Starting initialization...');

  // Run database initialization
  try {
    const { initializeDatabase } = await import('../utils/init-db');
    await initializeDatabase();
  } catch (error) {
    console.error('[Nitro] Database initialization failed:', error);
  }

  console.log('[Nitro] Initialization complete');
});
