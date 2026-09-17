import { getRequestHeader } from 'h3';
import type { H3Event } from 'h3';

function trustedProxyAddresses(): Set<string> {
  return new Set(
    (process.env.TRUSTED_PROXY_IPS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function getClientIp(event: H3Event): string {
  const socketIp = event.node.req.socket.remoteAddress ?? 'unknown';
  if (!trustedProxyAddresses().has(socketIp)) return socketIp;
  const cloudflareIp = getRequestHeader(event, 'cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp;
  return getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || socketIp;
}
