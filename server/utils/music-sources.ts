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

const PAGE_SIZE = 20;
const TIMEOUT_MS = 8_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sources: readonly SourceId[] = ['netease', 'qq', 'kugou'];

export const isSourceId = (value: unknown): value is SourceId =>
  typeof value === 'string' && sources.includes(value as SourceId);

async function fetchJson<T>(source: SourceId, url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { 'user-agent': USER_AGENT, ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new SourceError(source, `音源返回 HTTP ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    const message = error instanceof Error ? error.message : '请求音源失败';
    throw new SourceError(source, message, error);
  } finally {
    clearTimeout(timer);
  }
}

const joinArtists = (names: Array<string | null | undefined>) =>
  names
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(' / ') || '未知歌手';

const neteaseCover = (url: string | undefined) => {
  if (!url) return undefined;
  const target = url.replace(/^http:/, 'https:').replace(/\?param=.*$/, '?param=240y240');
  return `/api/cover/netease?url=${encodeURIComponent(target)}`;
};

interface NeteaseSong {
  id: number;
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; picUrl?: string };
  duration?: number;
  fee?: number;
}

async function searchNetease(keyword: string, page: number): Promise<SearchPage> {
  const query = new URLSearchParams({
    s: keyword,
    type: '1',
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  const body = await fetchJson<{ result?: { songCount?: number; songs?: NeteaseSong[] } }>(
    'netease',
    `https://music.163.com/api/search/get/web?${query}`,
    { headers: { referer: 'https://music.163.com/' } }
  );
  const songs = body.result?.songs ?? [];
  return {
    source: 'netease',
    keyword,
    page,
    pageSize: PAGE_SIZE,
    total: body.result?.songCount ?? songs.length,
    songs: songs.map((song) => ({
      source: 'netease',
      platformId: String(song.id),
      title: song.name?.trim() ?? '',
      artist: joinArtists((song.artists ?? []).map((artist) => artist.name)),
      album: song.album?.name?.trim() || undefined,
      durationMs: song.duration ?? 0,
      coverUrl: neteaseCover(song.album?.picUrl),
      vip: song.fee === 1 || song.fee === 4,
    })),
  };
}

interface QQTrack {
  mid?: string;
  name?: string;
  singer?: Array<{ name?: string }>;
  album?: { mid?: string; name?: string };
  interval?: number;
  pay?: { pay_play?: number };
}

async function searchQQ(keyword: string, page: number): Promise<SearchPage> {
  const body = await fetchJson<{
    req?: {
      code?: number;
      data?: { meta?: { sum?: number }; body?: { song?: { list?: QQTrack[] } } };
    };
  }>('qq', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { referer: 'https://y.qq.com/', 'content-type': 'application/json' },
    body: JSON.stringify({
      comm: { ct: '19', cv: '1859', uin: '0' },
      req: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: { query: keyword, num_per_page: PAGE_SIZE, page_num: page, search_type: 0 },
      },
    }),
  });
  const response = body.req;
  if (response?.code !== 0 || !response.data) {
    const detail =
      response?.code === 2001
        ? 'QQ 音乐暂时限制了本次搜索，请稍后几分钟再试，或改用网易云、酷狗。'
        : `QQ 音乐搜索暂时不可用（错误码 ${response?.code ?? 'unknown'}）`;
    throw new SourceError('qq', detail);
  }
  const tracks = response.data.body?.song?.list ?? [];
  return {
    source: 'qq',
    keyword,
    page,
    pageSize: PAGE_SIZE,
    total: response.data.meta?.sum ?? tracks.length,
    songs: tracks
      .filter((track): track is QQTrack & { mid: string } => Boolean(track.mid))
      .map((track) => ({
        source: 'qq',
        platformId: track.mid,
        title: track.name?.trim() ?? '',
        artist: joinArtists((track.singer ?? []).map((singer) => singer.name)),
        album: track.album?.name?.trim() || undefined,
        durationMs: (track.interval ?? 0) * 1000,
        coverUrl: track.album?.mid
          ? `https://y.qq.com/music/photo_new/T002R300x300M000${track.album.mid}.jpg`
          : undefined,
        vip: track.pay?.pay_play === 1,
      })),
  };
}

interface KugouSong {
  FileHash?: string;
  SongName?: string;
  SingerName?: string;
  AlbumName?: string;
  Duration?: number;
  Privilege?: number;
  Image?: string;
  AlbumImage?: string;
}

const stripTags = (value: string) => value.replace(/<[^>]+>/g, '').trim();

async function searchKugou(keyword: string, page: number): Promise<SearchPage> {
  const query = new URLSearchParams({
    keyword,
    page: String(page),
    pagesize: String(PAGE_SIZE),
    userid: '0',
    platform: 'WebFilter',
    filter: '2',
    iscorrection: '1',
    privilege_filter: '0',
  });
  const body = await fetchJson<{ data?: { total?: number; lists?: KugouSong[] } }>(
    'kugou',
    `https://songsearch.kugou.com/song_search_v2?${query}`,
    { headers: { referer: 'https://www.kugou.com/' } }
  );
  const songs = body.data?.lists ?? [];
  return {
    source: 'kugou',
    keyword,
    page,
    pageSize: PAGE_SIZE,
    total: body.data?.total ?? songs.length,
    songs: songs
      .filter((song): song is KugouSong & { FileHash: string } => Boolean(song.FileHash))
      .map((song) => ({
        source: 'kugou',
        platformId: song.FileHash.toUpperCase(),
        title: stripTags(song.SongName ?? ''),
        artist: stripTags(song.SingerName ?? '') || '未知歌手',
        album: song.AlbumName?.trim() || undefined,
        durationMs: (song.Duration ?? 0) * 1000,
        coverUrl: (song.Image ?? song.AlbumImage)?.replace('{size}', '240'),
        vip: song.Privilege === 10,
      })),
  };
}

// ── Detail functions ──────────────────────────────────────────────────

async function detailNetease(platformId: string): Promise<SongSummary | null> {
  try {
    const body = await fetchJson<{ songs?: NeteaseSong[] }>(
      'netease',
      `https://music.163.com/api/song/detail?ids=[${encodeURIComponent(platformId)}]`,
      { headers: { referer: 'https://music.163.com/' } }
    );
    const song = body.songs?.[0];
    if (!song) return null;
    return {
      source: 'netease',
      platformId: String(song.id),
      title: song.name?.trim() ?? '',
      artist: joinArtists((song.artists ?? []).map((a) => a.name)),
      album: song.album?.name?.trim() || undefined,
      durationMs: song.duration ?? 0,
      coverUrl: neteaseCover(song.album?.picUrl),
      vip: song.fee === 1 || song.fee === 4,
    };
  } catch {
    return null;
  }
}

async function detailQQ(platformId: string): Promise<SongSummary | null> {
  try {
    const body = await fetchJson<{
      req?: { code?: number; data?: { track_info?: QQTrack } };
    }>('qq', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { referer: 'https://y.qq.com/', 'content-type': 'application/json' },
      body: JSON.stringify({
        comm: { ct: '19', cv: '1859', uin: '0' },
        req: {
          module: 'music.pf_song_detail_svr',
          method: 'get_song_detail_yqq',
          param: { song_mid: platformId },
        },
      }),
    });
    const track = body.req?.data?.track_info;
    if (!track?.mid) return null;
    return {
      source: 'qq',
      platformId: track.mid,
      title: track.name?.trim() ?? '',
      artist: joinArtists((track.singer ?? []).map((s) => s.name)),
      album: track.album?.name?.trim() || undefined,
      durationMs: (track.interval ?? 0) * 1000,
      coverUrl: track.album?.mid
        ? `https://y.qq.com/music/photo_new/T002R300x300M000${track.album.mid}.jpg`
        : undefined,
      vip: track.pay?.pay_play === 1,
    };
  } catch {
    return null;
  }
}

async function detailKugou(_platformId: string): Promise<SongSummary | null> {
  // Kugou doesn't have a simple detail-by-hash API.
  // Search by hash is unreliable, so we skip server-side re-validation
  // and trust the client-submitted metadata from search results.
  // Return null to fall through to the "search cache" path.
  return null;
}

async function fetchDetail(source: SourceId, platformId: string): Promise<SongSummary | null> {
  switch (source) {
    case 'netease':
      return detailNetease(platformId);
    case 'qq':
      return detailQQ(platformId);
    case 'kugou':
      return detailKugou(platformId);
  }
}

export async function searchSongs(
  source: SourceId,
  keyword: string,
  page: number
): Promise<SearchPage> {
  switch (source) {
    case 'netease':
      return searchNetease(keyword, page);
    case 'qq':
      return searchQQ(keyword, page);
    case 'kugou':
      return searchKugou(keyword, page);
  }
}

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
