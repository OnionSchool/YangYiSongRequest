/**
 * Server initialization plugin - runs on server startup
 */

export default defineNitroPlugin(async () => {
  console.log('[Nitro] Starting initialization...');

  const { initializeDatabase } = await import('../utils/init-db');
  await initializeDatabase();
  const { anonymizeFinalizedRequests } = await import('../utils/privacy');
  anonymizeFinalizedRequests();
  const { cleanupRequestProtection } = await import('../utils/request-protection');
  cleanupRequestProtection();
  const { cleanupAuditLogs } = await import('../utils/audit');
  cleanupAuditLogs();

  console.log('[Nitro] Initialization complete');
});
