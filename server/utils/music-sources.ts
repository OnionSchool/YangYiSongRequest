import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { metingApi } from './schema';
import type { SourceId } from './domain';
import { SOURCES } from './domain';
import { fetchExternal, validateExternalUrl } from './external-url';
import { logError } from './logger';
import {
  audioUrlPaths,
  extractSongRecords,
  mapSongRecord,
  parseFieldMap,
  readField,
  renderFieldTemplate,
  renderTemplate,
  type JsonValue,
  type MappedSong,
} from './music-templates';

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
const METING_SEARCH_LIMIT = 60;
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

/** 音源实现形态：Meting 协议，或「URL 模板 + 字段映射」的纯 HTTP 形态。 */
export const PROVIDER_TYPES = ['meting', 'template'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface MetingApiConfig {
  id: string;
  name: string;
  type: ProviderType;
  /** meting provider 必有 baseUrl；模板 provider 为 null。 */
  baseUrl: string | null;
  platforms: SourceId[];
  capabilities: MetingCapability[];
  searchUrlTemplate: string | null;
  detailUrlTemplate: string | null;
  audioUrlTemplate: string | null;
  coverUrlTemplate: string | null;
  fieldMap: string | null;
  metadataCapable: boolean;
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

function parsePlatforms(value: string): SourceId[] {
  try {
    const platforms = JSON.parse(value) as unknown;
    if (Array.isArray(platforms)) {
      return platforms.filter(
        (platform): platform is SourceId =>
          typeof platform === 'string' && (SOURCES as readonly string[]).includes(platform)
      );
    }
  } catch {
    // Ignore malformed persisted configuration rather than breaking all source requests.
  }
  return [];
}

function parseProviderType(value: string | null | undefined): ProviderType {
  return value === 'template' ? 'template' : 'meting';
}

function parseMetingApiRow(row: {
  id: string;
  name: string;
  type: string | null;
  baseUrl: string | null;
  platforms: string;
  capabilities: string | null;
  searchUrlTemplate: string | null;
  detailUrlTemplate: string | null;
  audioUrlTemplate: string | null;
  coverUrlTemplate: string | null;
  fieldMap: string | null;
  metadataCapable: number;
  enabled: number;
  sortOrder: number;
  authToken: string | null;
}): MetingApiWithAuth {
  return {
    id: row.id,
    name: row.name,
    type: parseProviderType(row.type),
    baseUrl: row.baseUrl,
    platforms: parsePlatforms(row.platforms),
    capabilities: parseCapabilities(row.capabilities),
    searchUrlTemplate: row.searchUrlTemplate,
    detailUrlTemplate: row.detailUrlTemplate,
    audioUrlTemplate: row.audioUrlTemplate,
    coverUrlTemplate: row.coverUrlTemplate,
    fieldMap: row.fieldMap,
    metadataCapable: row.metadataCapable === 1,
    enabled: row.enabled === 1,
    sortOrder: row.sortOrder,
    authToken: row.authToken,
  };
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
    .map((row) => parseMetingApiRow(row))
    .filter((api) => api.platforms.includes(source) && api.capabilities.includes(capability));
}

/** Read all Meting API configs (for admin) */
export async function listMetingApis(): Promise<MetingApiConfig[]> {
  const rows = await db
    .select()
    .from(metingApi)
    .orderBy(asc(metingApi.sortOrder), asc(metingApi.createdAt));

  return rows.map((row) => {
    const { authToken, ...api } = parseMetingApiRow(row);
    return { ...api, authConfigured: Boolean(authToken) };
  });
}

// ── Meting HTTP ─────────────────────────────────────────────────────

/** Map internal source id to Meting server name */
function toMetingServer(source: SourceId): string {
  if (source === 'qq') return 'tencent';
  return source;
}

function metingApiAddress(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
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
  duration?: string | number;
  duration_ms?: string | number;
  interval?: string | number;
}

interface MetingUrl {
  url?: string;
}

interface MetingPicture {
  url?: string;
}

function metingResultUrl(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    for (const value of result) {
      const url = metingResultUrl(value);
      if (url) return url;
    }
    return null;
  }
  if (!result || typeof result !== 'object') return null;
  const value = result as { url?: unknown; data?: unknown };
  if (typeof value.url === 'string') return value.url;
  return metingResultUrl(value.data);
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
  let url: URL;
  if (!api.baseUrl) {
    // 只有模板 provider 会没有 baseUrl，走到这里说明配置被误用。
    throw new SourceError(source, 'Meting API 地址无效', api.name);
  }
  try {
    url = new URL(api.baseUrl);
  } catch {
    throw new SourceError(source, 'Meting API 地址无效', api.baseUrl);
  }
  const server = toMetingServer(source);
  url.searchParams.set('server', server);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // type / id 由调用方限定在 url、lrc、pic 三种取图上，缺任何一个就不加签名
  const { type, id } = params;
  if (api.authToken && type && id && ['url', 'lrc', 'pic'].includes(type)) {
    url.searchParams.set(
      'auth',
      createHmac('sha1', api.authToken).update(`${server}${type}${id}`).digest('hex')
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
  const apiUrl = metingApiAddress(api.baseUrl ?? '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchExternal(target, { signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
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
    let response: Response | undefined;
    try {
      response = await fetchExternal(metingRequestUrl(api, source, params), {
        signal: controller.signal,
        redirect: 'manual',
      });
      const location = response.headers.get('location');
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      const url = location
        ? await validExternalUrl(new URL(location, response.url).toString())
        : null;
      if (response.status >= 300 && response.status < 400 && url) return url;
      if (
        response.ok &&
        ((params.type === 'url' && contentType.startsWith('audio/')) ||
          (params.type === 'pic' && contentType.startsWith('image/')))
      ) {
        const directUrl = await validExternalUrl(response.url);
        if (directUrl) return directUrl;
      }
      if (response.ok && contentType.includes('json')) {
        const jsonUrl = await validExternalUrl(metingResultUrl(await response.json()));
        if (jsonUrl) return jsonUrl;
      }
      const isRedirect = response.status >= 300 && response.status < 400;
      const message =
        response.status >= 500
          ? 'Meting API 服务异常'
          : isRedirect
            ? 'Meting 重定向缺少地址'
            : response.ok
              ? 'Meting 未提供重定向下载地址'
              : 'Meting 返回非预期状态';
      logError(message, undefined, {
        meting: {
          api: metingApiAddress(api.baseUrl ?? ''),
          source,
          capability,
          platformId: params.id,
          statusCode: response.status,
          hasLocationHeader: Boolean(location),
          responseContentType: contentType.split(';', 1)[0] || undefined,
          redirectStatus: isRedirect ? 'expected' : 'unexpected',
          redirectRuleRequired: !isRedirect,
        },
      });
    } catch (error) {
      logError('Meting 音频重定向请求失败', error, {
        meting: {
          api: metingApiAddress(api.baseUrl ?? ''),
          source,
          capability,
          platformId: params.id,
        },
      });
      // Try the next configured API.
    } finally {
      await response?.body?.cancel().catch(() => undefined);
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

function durationMsFromSong(song: MetingSong): number | null {
  const raw = song.duration_ms ?? song.duration ?? song.interval;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const value = String(raw).trim();
  const clock = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) {
    const hours = Number(clock[1] ?? 0);
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric < 10_000 ? numeric * 1000 : numeric);
}

function songCoverUrl(source: SourceId, song: MetingSong): string | undefined {
  const picId = song.pic_id ?? idFromMetingUrl(song.pic);
  if (picId != null) return coverProxyUrl(source, String(picId));
  return song.pic?.startsWith('http://') || song.pic?.startsWith('https://') ? song.pic : undefined;
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
  let response: Response | undefined;
  try {
    response = await fetchExternal(url, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      return await validExternalUrl(new URL(location, response.url).toString());
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    return response.ok && contentType.startsWith('audio/') ? response.url : null;
  } catch {
    return null;
  } finally {
    await response?.body?.cancel().catch(() => undefined);
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
      const value = values[index];
      if (value === undefined) continue;
      results[index] = await mapper(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

// ── Search ──────────────────────────────────────────────────────────

// ── Template provider HTTP ──────────────────────────────

/**
 * 把响应文本解析成 JSON 值。
 *
 * 部分音源（酷我 `search.kuwo.cn` 就是典型）即使带了 `rformat=json`，返回的仍是
 * 用单引号包裹的类 JSON，`JSON.parse` 会直接报错。所以再做一次宽容修正：
 * 只在字符串字面量之外把单引号换成双引号。
 */
export function parseLooseJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    let out = '';
    let inString = false;
    let quote = '';
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i] as string;
      if (inString) {
        if (char === '\\') {
          out += char + (text[i + 1] ?? '');
          i += 1;
          continue;
        }
        if (char === quote) {
          inString = false;
          out += '"';
          continue;
        }
        // 原内容里的双引号在换成双引号字符串后必须转义。
        out += char === '"' ? '\\"' : char;
        continue;
      }
      if (char === "'" || char === '"') {
        inString = true;
        quote = char;
        out += '"';
        continue;
      }
      out += char;
    }
    return JSON.parse(out) as JsonValue;
  }
}

/** 模板音源的公共请求封装：模板渲染 + JSON 解析 + 白名单校验。 */
async function templateFetchJson(
  source: SourceId,
  template: string,
  vars: { id?: string; keyword?: string; page?: number; limit?: number; size?: number | string }
): Promise<JsonValue> {
  const target = renderTemplate(template, vars);
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    throw new SourceError(source, '音源模板地址无效', template);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchExternal(target, { signal: controller.signal }, [host]);
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceError(source, `音源接口返回 HTTP ${response.status}`, host);
    }
    const text = await response.text();
    try {
      return parseLooseJson(text);
    } catch {
      throw new SourceError(source, '音源接口未返回有效的 JSON', host);
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    const message = error instanceof Error ? error.message : '请求音源接口失败';
    throw new SourceError(source, message, host, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 封面地址解析优先级：
 * 1. coverUrlTemplate + 记录原始字段（酷我 web_albumpic_short 这类相对路径拼接）
 * 2. 搜索字段映射里的封面直链
 * 都没有则返回 undefined，前端显示占位图。
 */
function templateCoverUrl(
  song: MappedSong,
  coverTemplate?: string | null,
  record?: JsonValue
): string | undefined {
  if (coverTemplate && record) {
    const rendered = renderFieldTemplate(coverTemplate, record);
    if (rendered && /^https?:\/\//.test(rendered)) return rendered;
  }
  return song.cover && /^https?:\/\//.test(song.cover) ? song.cover : undefined;
}

/** 用模板音源搜索：遍历按优先级排序的 provider，先成功者胜出。 */
async function templateSearch(
  source: SourceId,
  keyword: string,
  page: number
): Promise<SearchPage> {
  const apis = (await getApisForSource(source, 'search')).filter(
    (api) => api.type === 'template' && api.searchUrlTemplate
  );
  if (apis.length === 0) {
    throw new SourceError(source, '未配置支持该平台“search”功能的音源');
  }
  let lastError: unknown;
  for (const api of apis) {
    try {
      const data = await templateFetchJson(source, api.searchUrlTemplate as string, {
        keyword,
        page,
      });
      const map = parseFieldMap(api.fieldMap);
      const records = extractSongRecords(data, map);
      // 封面模板需要记录原始字段（如酷我的 web_albumpic_short），
      // 所以这里保留 record 与映射结果配对传递，而不是映射后丢掉原始数据。
      const pairs = records
        .map((record) => ({ record, song: mapSongRecord(record, map) }))
        .filter(
          (pair): pair is { record: typeof pair.record; song: MappedSong } => pair.song !== null
        );
      if (pairs.length === 0) {
        lastError = new SourceError(source, '音源未返回搜索结果', api.name);
        continue;
      }

      const start = (page - 1) * PAGE_SIZE;
      const slice = pairs.slice(start, start + PAGE_SIZE);
      return {
        source,
        keyword,
        page,
        pageSize: PAGE_SIZE,
        total: pairs.length,
        songs: slice.map(({ record, song }) => {
          storeSignedAudioUrl(source, song.platformId, song.audio);
          return {
            source,
            platformId: song.platformId,
            title: song.title || '未知歌曲',
            artist: song.artist || '未知歌手',
            album: song.album,
            durationMs: song.durationMs,
            coverUrl: templateCoverUrl(song, api.coverUrlTemplate, record),
            vip: false,
          };
        }),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof SourceError
    ? lastError
    : new SourceError(source, '所有音源均不可用', undefined, lastError);
}

/** 模板音源的详情；未配置详情模板时返回 null，由调用方决定如何处理。 */
async function templateDetail(
  source: SourceId,
  requestedPlatformId: string
): Promise<SongSummary | null> {
  const apis = (await getApisForSource(source, 'metadata')).filter(
    (api) => api.type === 'template' && api.detailUrlTemplate
  );
  for (const api of apis) {
    try {
      const data = await templateFetchJson(source, api.detailUrlTemplate as string, {
        id: requestedPlatformId,
      });
      const map = parseFieldMap(api.fieldMap);
      const song = extractSongRecords(data, map)
        .map((record) => mapSongRecord(record, map))
        .find((item): item is MappedSong => item?.platformId === requestedPlatformId);
      if (!song) continue;
      return {
        source,
        platformId: song.platformId,
        title: song.title || '未知歌曲',
        artist: song.artist || '未知歌手',
        album: song.album,
        durationMs: song.durationMs,
        coverUrl: templateCoverUrl(song),
        vip: false,
      };
    } catch {
      // 下一个 provider
    }
  }
  return null;
}

/**
 * 请求音频解析端点并按响应形态取直链：
 *   1. 3xx 重定向 —— haitangw/nxinxz 这类直接 302 跳 CDN；
 *   2. audio/* 直链 —— 端点本身就是音频流；
 *   3. JSON —— lx 生态主流形态，用字段映射的 audio 路径（默认候选
 *      url/data.url/data 等）提取链接后再验证。
 */
async function resolveTemplateAudioEndpoint(
  target: string,
  audioPaths: readonly string[]
): Promise<string | null> {
  let response: Response | undefined;
  try {
    response = await fetchExternal(target, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      return await validExternalUrl(new URL(location, response.url).toString());
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.startsWith('audio/')) {
      return response.ok ? response.url : null;
    }
    if (!response.ok || !contentType.includes('json')) return null;
    const text = await response.text();
    let data: JsonValue;
    try {
      data = parseLooseJson(text);
    } catch {
      return null;
    }
    for (const path of audioPaths) {
      const value = readField(data, path);
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        return await validExternalUrl(value);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await response?.body?.cancel().catch(() => undefined);
  }
}

/** 模板音源的音频地址：先看缓存的直链，再渲染模板按响应形态解析。 */
async function templateAudioUrl(source: SourceId, platformIdValue: string): Promise<string | null> {
  const signedUrl = getSignedAudioUrl(source, platformIdValue);
  if (signedUrl) {
    const resolved = await resolveAudioUrl(signedUrl);
    if (resolved) return resolved;
  }
  const apis = (await getApisForSource(source, 'download')).filter(
    (api) => api.type === 'template' && api.audioUrlTemplate
  );
  for (const api of apis) {
    try {
      const target = renderTemplate(api.audioUrlTemplate as string, { id: platformIdValue });
      const resolved = await resolveTemplateAudioEndpoint(
        target,
        audioUrlPaths(parseFieldMap(api.fieldMap))
      );
      if (resolved) return resolved;
    } catch {
      // 下一个 provider
    }
  }
  return null;
}

/** 模板音源的封面：用封面模板 + 封面 id 换取图片地址。 */
async function templateCoverFetch(
  source: SourceId,
  picId: string,
  size: string
): Promise<string | null> {
  const apis = (await getApisForSource(source, 'metadata')).filter(
    (api) => api.type === 'template' && api.coverUrlTemplate
  );
  for (const api of apis) {
    try {
      const target = renderTemplate(api.coverUrlTemplate as string, { id: picId, size });
      return await validExternalUrl(target);
    } catch {
      // 下一个 provider
    }
  }
  return null;
}

/** 该平台是否有任何已启用的 provider 声明了 metadata 能力。 */
export async function sourceHasMetadata(source: SourceId): Promise<boolean> {
  const apis = await getApisForSource(source, 'metadata');
  return apis.some((api) => api.type === 'meting' || api.metadataCapable);
}

/** 平台无 metadata 能力时，允许前端回传歌曲信息（服务端仅做范围校验）。 */
export async function sourceAllowsClientMetadata(source: SourceId): Promise<boolean> {
  return !(await sourceHasMetadata(source));
}

async function loadSearchSongs(
  source: SourceId,
  keyword: string,
  page: number
): Promise<SearchPage> {
  // 平台只挂了模板 provider 时走模板分支；混配时保留原有 Meting 优先行为。
  const apis = await getApisForSource(source, 'search');
  const metingApis = apis.filter((api) => api.type === 'meting');
  if (metingApis.length === 0) return templateSearch(source, keyword, page);
  return metingSearch(source, keyword, page);
}

async function metingSearch(source: SourceId, keyword: string, page: number): Promise<SearchPage> {
  const songs = await metingFetch<MetingSong[]>(source, 'search', {
    type: 'search',
    id: keyword,
    limit: String(METING_SEARCH_LIMIT),
    page: '1',
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
        durationMs: durationMsFromSong(song) ?? 0,
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
  const apis = await getApisForSource(source, 'metadata');
  if (apis.length === 0) return null;
  // 纯模板平台直接走模板详情，不再尝试 Meting 协议。
  if (apis.every((api) => api.type === 'template')) {
    return templateDetail(source, requestedPlatformId);
  }
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
      durationMs: durationMsFromSong(song) ?? (await detectAudioDurationMs(source, id, song.url)),
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
  // 平台只挂模板 provider 时，Meting 重定向必然落空，直接走模板。
  const downloadApis = await getApisForSource(source, 'download');
  if (downloadApis.length > 0 && downloadApis.every((api) => api.type === 'template')) {
    return templateAudioUrl(source, platformId);
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
    return await validExternalUrl(metingResultUrl(result));
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
  const audioUrl =
    (signedUrl ? await resolveAudioUrl(signedUrl) : null) ??
    (await fetchAudioUrl(source, platformId));
  if (!audioUrl) return 0;
  const directory = await mkdtemp(join(tmpdir(), 'campus-radio-audio-'));
  const filePath = join(directory, `${randomBytes(8).toString('hex')}.audio`);
  try {
    const host = new URL(audioUrl).hostname;
    const response = await fetchExternal(audioUrl, {}, [host]);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const maxBytes = 20 * 1024 * 1024;
    const contentLength = Number(response.headers.get('content-length'));
    if (
      !response.ok ||
      !response.body ||
      !contentType.startsWith('audio/') ||
      (Number.isFinite(contentLength) && contentLength > maxBytes)
    ) {
      await response.body?.cancel();
      return 0;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return 0;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    await writeFile(filePath, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), {
      mode: 0o600,
    });
    const { stdout } = await ffprobe(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { timeout: 15_000, maxBuffer: 1_024 }
    );
    const durationMs = Math.round(Number.parseFloat(stdout.trim()) * 1000);
    return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  } catch {
    // ffprobe is intentionally optional: scheduling still works without it.
    return 0;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function fetchCoverUrl(
  source: SourceId,
  picId: string,
  size = '300'
): Promise<string | null> {
  const apis = await getApisForSource(source, 'metadata');
  if (apis.length > 0 && apis.every((api) => api.type === 'template')) {
    return templateCoverFetch(source, picId, size);
  }
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
    return await validExternalUrl(metingResultUrl(result));
  } catch {
    return null;
  }
}

// ── Public interface ────────────────────────────────────────────────

export const isSourceId = (value: unknown): value is SourceId =>
  typeof value === 'string' && (SOURCES as readonly string[]).includes(value);

export interface MusicSource {
  search(keyword: string, page: number): Promise<SearchPage>;
  detail(platformId: string): Promise<SongSummary | null>;
}

export function getSource(source: unknown): MusicSource | null {
  if (!isSourceId(source)) return null;
  const id = source;
  return {
    async search(keyword: string, page: number) {
      return searchSongs(id, keyword, page);
    },
    async detail(platformId: string) {
      return fetchDetail(id, platformId);
    },
  };
}
