import { getRequestHeader } from 'h3';
import { setAuditContext } from '../utils/audit';
import { getClientIp } from '../utils/request-ip';

/** Attach request metadata to audit records created while handling the request. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    setAuditContext({
      ip: getClientIp(event),
      userAgent: getRequestHeader(event, 'user-agent') ?? undefined,
    });
  });
});
