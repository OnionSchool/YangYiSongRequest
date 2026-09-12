/**
 * Request audit metadata is attached at the authentication boundary in utils/admin-auth.
 * This plugin remains as a stable extension point for future unauthenticated audit events.
 */
export default defineNitroPlugin(() => undefined);
