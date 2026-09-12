import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { metingApi } from './schema';
import type { SourceId } from './domain';

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
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'SourceError';
  }
}

const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 20;
const ffprobe = promisify(execFile);

// ── MetingApi DB types ──────────────────────────────────────────────

export interface MetingApiConfig {
  id: string;
  name: string;
  baseUrl: string;
  platforms: SourceId[];
  enabled: boolean;
  sortOrder: number;
}

/** Read all enabled Meting APIs supporting a given source, ordered by sortOrder */
async function getApisForSource(source: SourceId): Promise<MetingApiConfig[]> {
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
      enabled: true,
      sortOrder: row.sortOrder,
    }))
    .filter((api) => api.platforms.includes(source));
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
    enabled: row.enabled === 1,
    sortOrder: row.sortOrder,
  }));
}

// ── Meting HTTP ─────────────────────────────────────────────────────

/** Map internal source id to Meting server name */
function toMetingServer(source: SourceId): string {
  if (source === 'qq') return 'tencent';
  return source;
}

interface MetingSong {
  id?: string | number;
  name?: string;
  title?: string;
  artist?: string[] | string;
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

function validExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
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
  baseUrl: string,
  source: SourceId,
  params: Record<string, string>
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const query = new URLSearchParams({ server: toMetingServer(source), ...params });
  return `${base}?${query}`;
}

async function metingFetchRaw<T>(
  baseUrl: string,
  source: SourceId,
  params: Record<string, string>
): Promise<T> {
  const target = metingRequestUrl(baseUrl, source, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, { signal: controller.signal });
    if (!response.ok) {
      throw new SourceError(source, `Meting API 返回 HTTP ${response.status}`);
    }
    const data = (await response.json()) as unknown;
    assertUsableMetingResponse(source, params, data);
    return data as T;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    const message = error instanceof Error ? error.message : '请求 Meting API 失败';
    throw new SourceError(source, message, error);
  } finally {
    clearTimeout(timer);
  }
}

async function metingRedirect(
  source: SourceId,
  params: Record<string, string>
): Promise<string | null> {
  const apis = await getApisForSource(source);
  for (const api of apis) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(metingRequestUrl(api.baseUrl, source, params), {
        signal: controller.signal,
        redirect: 'manual',
      });
      const url = validExternalUrl(response.headers.get('location'));
      if (response.status >= 300 && response.status < 400 && url) return url;
    } catch {
      // Try the next configured API.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Try each configured API in order; throw if all fail */
async function metingFetch<T>(source: SourceId, params: Record<string, string>): Promise<T> {
  const apis = await getApisForSource(source);
  if (apis.length === 0) {
    throw new SourceError(source, '未配置支持该平台的 Meting API');
  }
  let lastError: unknown;
  for (const api of apis) {
    try {
      return await metingFetchRaw<T>(api.baseUrl, source, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof SourceError
    ? lastError
    : new SourceError(source, '所有 Meting API 均不可用', lastError);
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

function formatArtist(artist: string[] | string | undefined): string {
  if (Array.isArray(artist)) return artist.join(' / ') || '未知歌手';
  return String(artist) || '未知歌手';
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

export async function searchSongs(
  source: SourceId,
  keyword: string,
  page: number
): Promise<SearchPage> {
  const songs = await metingFetch<MetingSong[]>(source, {
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
      return {
        source,
        platformId: id,
        title: song.name ?? song.title ?? '',
        artist: formatArtist(song.artist),
        album: song.album || undefined,
        durationMs: await detectAudioDurationMs(source, id),
        coverUrl: songCoverUrl(source, song),
        vip: false,
      };
    }),
  };
}

// ── Detail ──────────────────────────────────────────────────────────

async function fetchDetail(source: SourceId, platformId: string): Promise<SongSummary | null> {
  try {
    const songs = await metingFetch<MetingSong[]>(source, {
      type: 'song',
      id: platformId,
    });
    const song = songs.find((item) => platformId(item) === platformId) ?? songs[0];
    const id = song ? platformId(song) : undefined;
    if (!song || !id) return null;

    return {
      source,
      platformId: id,
      title: song.name ?? song.title ?? '',
      artist: formatArtist(song.artist),
      album: song.album || undefined,
      durationMs: await detectAudioDurationMs(source, id),
      coverUrl: songCoverUrl(source, song),
      vip: false,
    };
  } catch {
    return null;
  }
}

// ── Audio URL ───────────────────────────────────────────────────────

export async function fetchAudioUrl(source: SourceId, platformId: string): Promise<string | null> {
  const redirectUrl = await metingRedirect(source, { type: 'url', id: platformId, br: '320' });
  if (redirectUrl) return redirectUrl;

  // Also accept Meting variants that return a JSON URL rather than a 302 redirect.
  try {
    const result = await metingFetch<MetingUrl>(source, {
      type: 'url',
      id: platformId,
      br: '320',
    });
    return validExternalUrl(result.url ?? null);
  } catch {
    return null;
  }
}

export async function detectAudioDurationMs(source: SourceId, platformId: string): Promise<number> {
  const audioUrl = await fetchAudioUrl(source, platformId);
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
  const redirectUrl = await metingRedirect(source, { type: 'pic', id: picId, cover: size });
  if (redirectUrl) return redirectUrl;

  try {
    const result = await metingFetch<MetingPicture>(source, {
      type: 'pic',
      id: picId,
      cover: size,
    });
    return validExternalUrl(result.url ?? null);
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
