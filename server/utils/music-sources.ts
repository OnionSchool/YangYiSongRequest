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

// ── Meting API ──────────────────────────────────────────────────────

function getMetingApiUrl(): string {
  const url = process.env.METING_API_URL;
  if (!url) throw new Error('未配置 METING_API_URL 环境变量');
  return url.replace(/\/+$/, '');
}

/** Map internal source id to Meting server name */
function toMetingServer(source: SourceId): string {
  if (source === 'qq') return 'tencent';
  return source;
}

interface MetingSong {
  id: string;
  name: string;
  artist: string[];
  album: string;
  pic_id: string;
  url_id: string;
  lyric_id: string;
  source: string;
}

interface MetingUrl {
  url: string;
  size: number;
  br: number;
}

async function metingFetch<T>(source: SourceId, params: Record<string, string>): Promise<T> {
  const base = getMetingApiUrl();
  const query = new URLSearchParams({
    server: toMetingServer(source),
    ...params,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}?${query}`, { signal: controller.signal });
    if (!response.ok) {
      throw new SourceError(source, `Meting API 返回 HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    const message = error instanceof Error ? error.message : '请求 Meting API 失败';
    throw new SourceError(source, message, error);
  } finally {
    clearTimeout(timer);
  }
}

/** Build a cover proxy URL so the frontend can lazily load cover images */
function coverProxyUrl(source: SourceId, picId: string): string {
  return `/api/cover/meting?server=${toMetingServer(source)}&id=${encodeURIComponent(picId)}`;
}

function formatArtist(artist: string[] | string): string {
  if (Array.isArray(artist)) return artist.join(' / ') || '未知歌手';
  return String(artist) || '未知歌手';
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

  // Meting search returns all results; simulate pagination client-side
  const total = songs.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = songs.slice(start, start + PAGE_SIZE);

  return {
    source,
    keyword,
    page,
    pageSize: PAGE_SIZE,
    total,
    songs: slice.map((song) => ({
      source,
      platformId: song.id,
      title: song.name,
      artist: formatArtist(song.artist),
      album: song.album || undefined,
      durationMs: 0,
      coverUrl: song.pic_id ? coverProxyUrl(source, song.pic_id) : undefined,
      vip: false,
    })),
  };
}

// ── Detail ──────────────────────────────────────────────────────────

async function fetchDetail(source: SourceId, platformId: string): Promise<SongSummary | null> {
  try {
    const songs = await metingFetch<MetingSong[]>(source, {
      type: 'song',
      id: platformId,
    });
    if (!songs.length) return null;
    const song = songs[0];

    return {
      source,
      platformId: song.id,
      title: song.name,
      artist: formatArtist(song.artist),
      album: song.album || undefined,
      durationMs: 0,
      coverUrl: song.pic_id ? coverProxyUrl(source, song.pic_id) : undefined,
      vip: false,
    };
  } catch {
    return null;
  }
}

// ── Audio URL ───────────────────────────────────────────────────────

export async function fetchAudioUrl(source: SourceId, platformId: string): Promise<string | null> {
  try {
    const result = await metingFetch<MetingUrl>(source, {
      type: 'url',
      id: platformId,
    });
    return result.url || null;
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
