/**
 * Server initialization plugin - runs on server startup
 */

export default defineNitroPlugin(async () => {
  try {
    const { initializeDatabase } = await import('../utils/init-db');
    await initializeDatabase();
    const { anonymizeFinalizedRequests } = await import('../utils/privacy');
    anonymizeFinalizedRequests();
    const { cleanupRequestProtection } = await import('../utils/request-protection');
    cleanupRequestProtection();
    const { cleanupAuditLogs } = await import('../utils/audit');
    cleanupAuditLogs();
  } catch (error) {
    const { logError } = await import('../utils/logger');
    logError('服务器初始化失败', error);
    throw error;
  }
});
