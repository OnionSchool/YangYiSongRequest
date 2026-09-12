import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { badRequest } from './errors';

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.MUSIC_EXTERNAL_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isPrivateAddress(address: string): boolean {
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4) return isPrivateAddress(mappedIpv4);
  if (isIP(address) === 4) {
    const [first, second] = address.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('::ffff:127.')
    );
  }
  return true;
}

export async function validateExternalUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('BAD_URL', '地址格式无效');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw badRequest('BAD_URL', '地址必须是 HTTP 或 HTTPS 公网地址');
  }
  if (!allowedHosts().has(url.hostname.toLowerCase())) {
    throw badRequest('BAD_URL', '地址主机不在允许列表中');
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw badRequest('BAD_URL', '地址无法解析');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw badRequest('BAD_URL', '地址不能指向内网或本机');
  }
  return url;
}

export async function fetchExternal(
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  let url = await validateExternalUrl(String(input));
  if (init.redirect === 'manual') return fetch(url, init);
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetch(url, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    url = await validateExternalUrl(new URL(location, url).toString());
  }
  throw badRequest('TOO_MANY_REDIRECTS', '外部地址重定向次数过多');
}
