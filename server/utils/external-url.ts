import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Client, fetch as undiciFetch } from 'undici';
import type { Dispatcher } from 'undici';
import { db } from './db';
import { badRequest } from './errors';
import { metingApi } from './schema';

function configuredHosts(): Set<string> {
  const hosts = new Set(
    (process.env.MUSIC_EXTERNAL_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
  try {
    for (const { baseUrl } of db.select({ baseUrl: metingApi.baseUrl }).from(metingApi).all()) {
      hosts.add(new URL(baseUrl).hostname.toLowerCase());
    }
  } catch {
    // The database may not be initialized while running isolated validation tests.
  }
  return hosts;
}

// IANA IPv6 Special-Purpose Address Registry entries marked “Globally Reachable: False”.
const NON_GLOBAL_IPV6_CIDRS = [
  '::/96',
  '::ffff:0:0/96',
  '64:ff9b:1::/48',
  '100::/64',
  '100:0:0:1::/64',
  '2001::/23',
  '2001:2::/48',
  '2001:db8::/32',
  '3fff::/20',
  '5f00::/16',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
] as const;

// These are the globally reachable exceptions in IETF Protocol Assignments (2001::/23).
const GLOBAL_IPV6_EXCEPTION_CIDRS = [
  '2001:1::1/128',
  '2001:1::2/128',
  '2001:1::3/128',
  '2001:3::/32',
  '2001:4:112::/48',
  '2001:20::/28',
  '2001:30::/28',
] as const;

function ipv6Segments(address: string): number[] {
  const [before = '', after = ''] = address.toLowerCase().split('::');
  const left = before ? before.split(':') : [];
  const right = after ? after.split(':') : [];
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map((part) =>
    Number.parseInt(part, 16)
  );
}

function isInIpv6Cidr(address: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const addressSegments = ipv6Segments(address);
  const networkSegments = ipv6Segments(network ?? '');
  const fullSegments = Math.floor(prefix / 16);
  const remainingBits = prefix % 16;
  if (
    addressSegments.slice(0, fullSegments).some((part, index) => part !== networkSegments[index])
  ) {
    return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (addressSegments[fullSegments]! & mask) === (networkSegments[fullSegments]! & mask);
}

function isPrivateAddress(address: string): boolean {
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4) return isPrivateAddress(mappedIpv4);
  if (isIP(address) === 4) {
    const [first, second, third] = address.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      first === 127 ||
      first >= 224 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 192 && second === 31 && third === 196) ||
      (first === 192 && second === 52 && third === 193) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 175 && third === 48) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113)
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const [firstSegment = 0] = ipv6Segments(normalized);
    // Global-unicast IPv6 uses 2000::/3. Preserve specific IANA global
    // allocations within 2001::/23 while rejecting non-global special-purpose ranges.
    return (
      (firstSegment & 0xe000) !== 0x2000 ||
      (!GLOBAL_IPV6_EXCEPTION_CIDRS.some((cidr) => isInIpv6Cidr(normalized, cidr)) &&
        NON_GLOBAL_IPV6_CIDRS.some((cidr) => isInIpv6Cidr(normalized, cidr)))
    );
  }
  return true;
}

interface ValidatedExternalUrl {
  url: URL;
  address: string;
  family: number;
}

async function validateExternalConnection(
  value: string,
  additionalTrustedHosts: Iterable<string> = []
): Promise<ValidatedExternalUrl> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('BAD_URL', '地址格式无效');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw badRequest('BAD_URL', '地址必须是 HTTP 或 HTTPS 公网地址');
  }
  const hosts = configuredHosts();
  for (const host of additionalTrustedHosts) hosts.add(host.toLowerCase());
  if (!hosts.has(url.hostname.toLowerCase())) {
    throw badRequest('BAD_URL', '地址主机不在允许列表中');
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw badRequest('BAD_URL', '地址无法解析');
  }
  const address = addresses.find(({ address }) => !isPrivateAddress(address));
  if (!address || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw badRequest('BAD_URL', '地址不能指向内网或本机');
  }
  return { url, address: address.address, family: address.family };
}

export async function validateExternalUrl(
  value: string,
  additionalTrustedHosts: Iterable<string> = []
): Promise<URL> {
  return (await validateExternalConnection(value, additionalTrustedHosts)).url;
}

/** Requests only a host/address pair returned by validateExternalConnection. */
async function fetchValidatedExternal(
  validated: ValidatedExternalUrl,
  init: RequestInit
): Promise<Response> {
  const dispatcher: Dispatcher = new Client(validated.url.origin, {
    connect: {
      autoSelectFamily: false,
      lookup: (_hostname, _options, callback) =>
        callback(null, validated.address, validated.family === 6 ? 6 : 4),
    },
  });
  let closed = false;
  const closeDispatcher = () => {
    if (closed) return;
    closed = true;
    // The wrapped body must finish or cancel before this one-shot client closes.
    void dispatcher.close().catch(() => dispatcher.destroy());
  };
  try {
    // SAFETY: Undici's Fetch API is standards-compatible with the runtime Response consumed here.
    const response = (await undiciFetch(validated.url, {
      ...init,
      dispatcher,
    })) as unknown as Response;
    if (!response.body) {
      closeDispatcher();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            closeDispatcher();
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          closeDispatcher();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          closeDispatcher();
        }
      },
    });
    const wrappedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(wrappedResponse, 'url', { value: response.url });
    return wrappedResponse;
  } catch (error) {
    closeDispatcher();
    throw error;
  }
}

export async function fetchExternal(
  input: string | URL,
  init: RequestInit = {},
  additionalTrustedHosts: Iterable<string> = []
): Promise<Response> {
  let validated = await validateExternalConnection(String(input), additionalTrustedHosts);
  if (init.redirect === 'manual') return fetchValidatedExternal(validated, init);
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetchValidatedExternal(validated, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel();
    validated = await validateExternalConnection(
      new URL(location, validated.url).toString(),
      additionalTrustedHosts
    );
  }
  throw badRequest('TOO_MANY_REDIRECTS', '外部地址重定向次数过多');
}
