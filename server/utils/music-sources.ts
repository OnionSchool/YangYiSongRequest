import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { metingApi } from './schema';
import type { SourceId } from './domain';
import { fetchExternal, validateExternalUrl } from './external-url';
import { logError } from './logger';

export interface SongSummary {
  source: SourceId;
  platformId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  coverUrl?: string;
  vip: boolean;
}

export interface SearchPage {
  source: SourceId;
  keyword: string;
  page: number;
  pageSize: number;
  total: number;
  songs: SongSummary[];
}

export class SourceError extends Error {
  constructor(
    readonly source: SourceId,
    message: string,
    readonly apiUrl?: string,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'SourceError';
  }
}

const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 20;
const SEARCH_CACHE_TTL_MS = 60 * 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 400;
const SIGNED_AUDIO_URL_MAX_ENTRIES = SEARCH_CACHE_MAX_ENTRIES * PAGE_SIZE;
const ffprobe = promisify(execFile);

interface CachedSearchPage {
  expiresAt: number;
  value: SearchPage;
}

// A process-local cache intentionally stores only successful, fully mapped pages. This also
// avoids repeating the URL and ffprobe calls used to obtain missing Meting durations.
const searchCache = new Map<string, CachedSearchPage>();
const pendingSearches = new Map<string, Promise<SearchPage>>();
const signedAudioUrls = new Map<string, { expiresAt: number; url: string }>();

function signedAudioUrlKey(source: SourceId, platformId: string): string {
  return `${source}\u0000${platformId}`;
}

function storeSignedAudioUrl(source: SourceId, platformId: string, url: string | undefined): void {
  if (!url) return;
  const key = signedAudioUrlKey(source, platformId);
  if (signedAudioUrls.has(key)) signedAudioUrls.delete(key);
  signedAudioUrls.set(key, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    url,
  });
  while (signedAudioUrls.size > SIGNED_AUDIO_URL_MAX_ENTRIES) {
    const oldestKey = signedAudioUrls.keys().next().value;
    if (!oldestKey) break;
    signedAudioUrls.delete(oldestKey);
  }
}

function getSignedAudioUrl(source: SourceId, platformId: string): string | null {
  const key = signedAudioUrlKey(source, platformId);
  const entry = signedAudioUrls.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    signedAudioUrls.delete(key);
    return null;
  }
  return entry.url;
}

function searchCacheKey(source: SourceId, keyword: string, page: number): string {
  const normalizedKeyword = keyword
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('zh-CN');
  return `${source}\u0000${normalizedKeyword}\u0000${page}`;
}

function copySearchPage(page: SearchPage, keyword: string): SearchPage {
  return { ...page, keyword, songs: page.songs.map((song) => ({ ...song })) };
}

function storeSearchPage(key: string, value: SearchPage): void {
  if (searchCache.has(key)) searchCache.delete(key);
  searchCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value });
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
}

/** Clear cached searches after a Meting provider is created, changed, or removed. */
export function invalidateMusicSearchCache(): void {
  searchCache.clear();
  signedAudioUrls.clear();
}

// ── MetingApi DB types ──────────────────────────────────────────────

export const METING_CAPABILITIES = ['search', 'metadata', 'download'] as const;
export type MetingCapability = (typeof METING_CAPABILITIES)[number];

export interface MetingApiConfig {
  id: string;
  name: string;
  baseUrl: string;
  platforms: SourceId[];
  capabilities: MetingCapability[];
  enabled: boolean;
  sortOrder: number;
  authConfigured: boolean;
}

interface MetingApiWithAuth extends Omit<MetingApiConfig, 'authConfigured'> {
  authToken: string | null;
}

function parseCapabilities(value: string | null | undefined): MetingCapability[] {
  try {
    const capabilities = JSON.parse(value ?? '') as unknown;
    if (Array.isArray(capabilities)) {
      const valid = capabilities.filter(
        (capability): capability is MetingCapability =>
          typeof capability === 'string' &&
          METING_CAPABILITIES.includes(capability as MetingCapability)
      );
      if (valid.length > 0) return [...new Set(valid)];
    }
  } catch {
    // Existing configurations created before capabilities were added use all features.
  }
  return [...METING_CAPABILITIES];
}

/** Read enabled Meting APIs for a platform and capability, ordered by priority. */
async function getApisForSource(
  source: SourceId,
  capability: MetingCapability
): Promise<MetingApiWithAuth[]> {
  const rows = await db
    .select()
    .from(metingApi)
    .where(eq(metingApi.enabled, 1))
    .orderBy(asc(metingApi.sortOrder), asc(metingApi.createdAt));

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      platforms: JSON.parse(row.platforms) as SourceId[],
      capabilities: parseCapabilities(row.capabilities),
      enabled: true,
      sortOrder: row.sortOrder,
      authToken: row.authToken,
    }))
    .filter((api) => api.platforms.includes(source) && api.capabilities.includes(capability));
}

/** Read all Meting API configs (for admin) */
export async function listMetingApis(): Promise<MetingApiConfig[]> {
  const rows = await db
    .select()
    .from(metingApi)
    .orderBy(asc(metingApi.sortOrder), asc(metingApi.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    platforms: JSON.parse(row.platforms) as SourceId[],
    capabilities: parseCapabilities(row.capabilities),
    enabled: row.enabled === 1,
    sortOrder: row.sortOrder,
    authConfigured: Boolean(row.authToken),
  }));
}

// ── Meting HTTP ─────────────────────────────────────────────────────

/** Map internal source id to Meting server name */
function toMetingServer(source: SourceId): string {
  if (source === 'qq') return 'tencent';
  return source;
}

function metingApiAddress(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

interface MetingSong {
  id?: string | number;
  name?: string;
  title?: string;
  artist?: string[] | string;
  author?: string[] | string;
  album?: string;
  pic_id?: string | number;
  pic?: string;
  url_id?: string | number;
  url?: string;
  lyric_id?: string | number;
  source?: string;
}

interface MetingUrl {
  url?: string;
}

interface MetingPicture {
  url?: string;
}

async function validExternalUrl(value: string | null): Promise<string | null> {
  if (!value) return null;
  try {
    const host = new URL(value).hostname;
    return (await validateExternalUrl(value, [host])).toString();
  } catch {
    return null;
  }
}

function assertUsableMetingResponse(
  source: SourceId,
  params: Record<string, string>,
  data: unknown
): void {
  if (typeof data === 'object' && data !== null && !Array.isArray(data) && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    throw new SourceError(source, `Meting API 业务错误：${String(error ?? 'unknown')}`);
  }
  if (params.type === 'search') {
    if (!Array.isArray(data)) throw new SourceError(source, 'Meting API 未返回歌曲列表');
    if (data.length === 0) throw new SourceError(source, 'Meting API 未返回搜索结果');
  }
}

function metingRequestUrl(
  api: MetingApiWithAuth,
  source: SourceId,
  params: Record<string, string>
): string {
  const url = new URL(api.baseUrl);
  const server = toMetingServer(source);
  url.searchParams.set('server', server);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (api.authToken && ['url', 'lrc', 'pic'].includes(params.type)) {
    url.searchParams.set(
      'auth',
      createHmac('sha1', api.authToken).update(`${server}${params.type}${params.id}`).digest('hex')
    );
  }
  return url.toString();
}

async function metingFetchRaw<T>(
  api: MetingApiWithAuth,
  source: SourceId,
  params: Record<string, string>
): Promise<T> {
  const target = metingRequestUrl(api, source, params);
  const apiUrl = metingApiAddress(api.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchExternal(target, { signal: controller.signal });
    if (!response.ok) {
      throw new SourceError(source, `Meting API 返回 HTTP ${response.status}`, apiUrl);
    }
    const data = (await response.json()) as unknown;
    assertUsableMetingResponse(source, params, data);
    return data as T;
  } catch (error) {
    if (error instanceof SourceError) {
      throw error.apiUrl ? error : new SourceError(source, error.message, apiUrl, error);
    }
    const message = error instanceof Error ? error.message : '请求 Meting API 失败';
    throw new SourceError(source, message, apiUrl, error);
  } finally {
    clearTimeout(timer);
  }
}

async function metingRedirect(
  source: SourceId,
  capability: MetingCapability,
  params: Record<string, string>
): Promise<string | null> {
  const apis = await getApisForSource(source, capability);
  for (const api of apis) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchExternal(metingRequestUrl(api, source, params), {
        signal: controller.signal,
        redirect: 'manual',
      });
      const location = response.headers.get('location');
      const url = location
        ? await validExternalUrl(new URL(location, response.url).toString())
        : null;
      if (response.status >= 300 && response.status < 400 && url) return url;
      logError('Meting 未返回音频重定向地址', undefined, {
        meting: { api: metingApiAddress(api.baseUrl), source, capability, platformId: params.id },
      });
    } catch (error) {
      logError('Meting 音频重定向请求失败', error, {
        meting: { api: metingApiAddress(api.baseUrl), source, capability, platformId: params.id },
      });
      // Try the next configured API.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Try each configured API in order; throw if all fail */
async function metingFetch<T>(
  source: SourceId,
  capability: MetingCapability,
  params: Record<string, string>
): Promise<T> {
  const apis = await getApisForSource(source, capability);
  if (apis.length === 0) {
    throw new SourceError(source, `未配置支持该平台“${capability}”功能的 Meting API`);
  }
  let lastError: unknown;
  for (const api of apis) {
    try {
      return await metingFetchRaw<T>(api, source, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof SourceError
    ? lastError
    : new SourceError(source, '所有 Meting API 均不可用', undefined, lastError);
}

/** Build a cover proxy URL */
function coverProxyUrl(source: SourceId, picId: string): string {
  return `/api/cover/meting?server=${toMetingServer(source)}&id=${encodeURIComponent(picId)}`;
}

function idFromMetingUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).searchParams.get('id') || undefined;
  } catch {
    return undefined;
  }
}

function platformId(song: MetingSong): string | undefined {
  const id = song.id ?? song.url_id ?? idFromMetingUrl(song.url);
  return id == null ? undefined : String(id);
}

function songCoverUrl(source: SourceId, song: MetingSong): string | undefined {
  if (song.pic?.startsWith('http://') || song.pic?.startsWith('https://')) return song.pic;
  return song.pic_id == null ? undefined : coverProxyUrl(source, String(song.pic_id));
}

function formatArtist(
  artist: string[] | string | undefined,
  author: string[] | string | undefined
): string {
  artist ??= author;
  if (Array.isArray(artist)) return artist.join(' / ') || '未知歌手';
  return String(artist) || '未知歌手';
}

async function resolveAudioUrl(url: string): Promise<string | null> {
  try {
    const response = await fetchExternal(url, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      return await validExternalUrl(new URL(location, response.url).toString());
    }
    return response.ok ? response.url : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

// ── Search ──────────────────────────────────────────────────────────

async function loadSearchSongs(
  source: SourceId,
  keyword: string,
  page: number
): Promise<SearchPage> {
  const songs = await metingFetch<MetingSong[]>(source, 'search', {
    type: 'search',
    id: keyword,
  });

  const validSongs = songs.filter((song) => Boolean(platformId(song)));
  const total = validSongs.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = validSongs.slice(start, start + PAGE_SIZE);

  return {
    source,
    keyword,
    page,
    pageSize: PAGE_SIZE,
    total,
    songs: await mapWithConcurrency(slice, 4, async (song) => {
      const id = platformId(song) as string;
      storeSignedAudioUrl(source, id, song.url);
      return {
        source,
        platformId: id,
        title: song.name ?? song.title ?? '',
        artist: formatArtist(song.artist, song.author),
        album: song.album || undefined,
        durationMs: await detectAudioDurationMs(source, id, song.url),
        coverUrl: songCoverUrl(source, song),
        vip: false,
      };
    }),
  };
}

export async function searchSongs(
  source: SourceId,
  keyword: string,
  page: number
): Promise<SearchPage> {
  const key = searchCacheKey(source, keyword, page);
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return copySearchPage(cached.value, keyword);
  if (cached) searchCache.delete(key);

  let pending = pendingSearches.get(key);
  if (!pending) {
    pending = loadSearchSongs(source, keyword, page).then((result) => {
      storeSearchPage(key, result);
      return result;
    });
    pendingSearches.set(key, pending);
    void pending.then(
      () => pendingSearches.delete(key),
      () => pendingSearches.delete(key)
    );
  }
  return copySearchPage(await pending, keyword);
}

// ── Detail ──────────────────────────────────────────────────────────

async function fetchDetail(
  source: SourceId,
  requestedPlatformId: string
): Promise<SongSummary | null> {
  try {
    const songs = await metingFetch<MetingSong[]>(source, 'metadata', {
      type: 'song',
      id: requestedPlatformId,
    });
    const song = songs.find((item) => platformId(item) === requestedPlatformId);
    const id = song ? platformId(song) : undefined;
    if (!song || !id) return null;

    return {
      source,
      platformId: id,
      title: song.name ?? song.title ?? '',
      artist: formatArtist(song.artist, song.author),
      album: song.album || undefined,
      durationMs: await detectAudioDurationMs(source, id, song.url),
      coverUrl: songCoverUrl(source, song),
      vip: false,
    };
  } catch {
    return null;
  }
}

// ── Audio URL ───────────────────────────────────────────────────────

export async function fetchAudioUrl(source: SourceId, platformId: string): Promise<string | null> {
  const signedUrl = getSignedAudioUrl(source, platformId);
  if (signedUrl) {
    const resolvedUrl = await resolveAudioUrl(signedUrl);
    if (resolvedUrl) return resolvedUrl;
  }
  const redirectUrl = await metingRedirect(source, 'download', {
    type: 'url',
    id: platformId,
    br: '320',
  });
  if (redirectUrl) return redirectUrl;

  // Also accept Meting variants that return a JSON URL rather than a 302 redirect.
  try {
    const result = await metingFetch<MetingUrl>(source, 'download', {
      type: 'url',
      id: platformId,
      br: '320',
    });
    return await validExternalUrl(result.url ?? null);
  } catch (error) {
    if (error instanceof SourceError && error.apiUrl) {
      logError('Meting 未返回音频地址', error, {
        meting: { api: error.apiUrl, source, capability: 'download', platformId },
      });
    }
    return null;
  }
}

export async function detectAudioDurationMs(
  source: SourceId,
  platformId: string,
  signedUrl?: string
): Promise<number> {
  const audioUrl = signedUrl
    ? await resolveAudioUrl(signedUrl)
    : await fetchAudioUrl(source, platformId);
  if (!audioUrl) return 0;
  try {
    const { stdout } = await ffprobe(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioUrl,
      ],
      { timeout: 15_000, maxBuffer: 1_024 }
    );
    const durationMs = Math.round(Number.parseFloat(stdout.trim()) * 1000);
    return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  } catch {
    // ffprobe is intentionally optional: scheduling still works without it.
    return 0;
  }
}

export async function fetchCoverUrl(
  source: SourceId,
  picId: string,
  size = '300'
): Promise<string | null> {
  const redirectUrl = await metingRedirect(source, 'metadata', {
    type: 'pic',
    id: picId,
    cover: size,
  });
  if (redirectUrl) return redirectUrl;

  try {
    const result = await metingFetch<MetingPicture>(source, 'metadata', {
      type: 'pic',
      id: picId,
      cover: size,
    });
    return await validExternalUrl(result.url ?? null);
  } catch {
    return null;
  }
}

// ── Public interface ────────────────────────────────────────────────

export const isSourceId = (value: unknown): value is SourceId =>
  typeof value === 'string' && ['netease', 'qq', 'kugou'].includes(value);

export interface MusicSource {
  search(keyword: string, page: number): Promise<SearchPage>;
  detail(platformId: string): Promise<SongSummary | null>;
}

export function getSource(source: unknown): MusicSource | null {
  if (source === 'netease' || source === 'qq' || source === 'kugou') {
    return {
      async search(keyword: string, page: number) {
        return searchSongs(source, keyword, page);
      },
      async detail(platformId: string) {
        return fetchDetail(source, platformId);
      },
    };
  }
  return null;
}
