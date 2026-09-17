// 后端接口的唯一入口。契约见 API.md。
// 约定：后端所有错误都是 { error: { code, message } }，message 是可以直接显示给学生的中文。

export type SourceId = 'netease' | 'qq' | 'kugou';
export type Grade = 'G1' | 'G2' | 'G3';
export type RequestStatus = 'PENDING' | 'SCHEDULED' | 'REJECTED' | 'CANCELLED' | 'PLAYED';

export const SOURCES: Array<{ id: SourceId; label: string }> = [
  { id: 'netease', label: '网易云音乐' },
  { id: 'qq', label: 'QQ 音乐' },
  { id: 'kugou', label: '酷狗音乐' },
];

export const GRADE_OPTIONS: Array<{ value: Grade; label: string }> = [
  { value: 'G1', label: '高一' },
  { value: 'G2', label: '高二' },
  { value: 'G3', label: '高三' },
];

export interface ServerInfo {
  version: string;
  serverTime: string;
}

export interface Song {
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
  songs: Song[];
}

export interface SlotView {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  maxCount: number | null;
  maxMs: number | null;
}

export interface SiteSnapshot {
  requestsOpen: boolean;
  guestPreviewOpen: boolean;
  requireIdentity: boolean;
  announcement: string;
  maxScheduleDays: number;
  slots: SlotView[];
  classCounts: Record<Grade, number>;
}

export interface LookupResult {
  queryCode: string;
  status: RequestStatus;
  statusLabel: string;
  source: SourceId;
  title: string;
  artist: string;
  coverUrl: string | null;
  durationMs: number;
  createdAt: string;
  rejectReason: string | null;
  schedule: { playDate: string; slotName: string; orderNo: number } | null;
}

export interface PlaylistSong {
  id: string;
  source: SourceId;
  platformId: string;
  title: string;
  artist: string;
  coverUrl?: string;
  durationMs: number;
  orderNo: number;
  playTime: string;
  playbackStatus: 'PENDING_DOWNLOAD' | 'DOWNLOADED' | 'PLAYED' | 'PLAYBACK_ERROR';
}

export interface PlaylistSlot {
  slotId: string;
  slotName: string;
  startTime: string;
  endTime: string;
  totalMs: number;
  songs: PlaylistSong[];
}

export interface PlaylistDay {
  date: string;
  slots: PlaylistSlot[];
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** 管理端的请求也复用这套错误处理，见 lib/adminApi.ts */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(csrfToken && init?.method && !['GET', 'HEAD'].includes(init.method)
          ? { 'x-csrf-token': csrfToken }
          : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('NETWORK', '连不上服务器，检查一下网络', 0);
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('PARSE', `服务返回了无法解析的响应`, response.status);
  }
  const payload = data as {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  } | null;
  if (!response.ok) {
    throw new ApiError(
      typeof payload?.code === 'string' ? payload.code : 'UNKNOWN',
      typeof payload?.message === 'string' ? payload.message : `服务返回 ${response.status}`,
      response.status
    );
  }
  if (payload?.code !== 0 || !payload || !('data' in payload)) {
    throw new ApiError('INVALID_RESPONSE', '服务返回了不符合规范的响应', response.status);
  }
  const result = payload.data as T;
  const token = (result as { csrfToken?: unknown } | null)?.csrfToken;
  if (typeof token === 'string') setCsrfToken(token);
  return result;
}

export const fetchServerInfo = () => apiFetch<ServerInfo>('/api/version');

export const fetchSite = () => apiFetch<SiteSnapshot>('/api/site');

export const searchSongs = (source: SourceId, keyword: string, page = 1) =>
  apiFetch<SearchPage>(
    `/api/search/song?source=${source}&keyword=${encodeURIComponent(keyword)}&page=${page}`
  );

export interface SubmitBody {
  source: SourceId;
  platformId: string;
  grade?: Grade;
  classNo?: number;
  requesterName?: string;
  // Song metadata fallback (used when server detail() unavailable, e.g. kugou)
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  coverUrl?: string;
  challengeId?: string;
  nonce?: string;
  contextHash?: string;
}

export interface PowChallenge {
  challengeId: string;
  difficulty: number;
  expiresAt: number;
}

export function requestContextHash(
  body: Omit<SubmitBody, 'challengeId' | 'nonce' | 'contextHash'>
): string {
  return JSON.stringify({
    source: body.source,
    platformId: body.platformId.trim(),
    title: body.title?.trim() ?? '',
    artist: body.artist?.trim() ?? '',
    album: body.album?.trim() ?? '',
    durationMs: Number(body.durationMs) || 0,
    coverUrl: body.coverUrl?.trim() ?? '',
    grade: body.grade ?? '',
    classNo: Number(body.classNo) || 0,
    requesterName: body.requesterName?.trim() ?? '',
  });
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const createPowChallenge = (contextHash: string) =>
  apiFetch<PowChallenge>('/api/request/challenge', {
    method: 'POST',
    body: JSON.stringify({ contextHash }),
  });

export const checkContent = (body: Pick<SubmitBody, 'title' | 'artist' | 'requesterName'>) =>
  apiFetch<{ allowed: boolean }>('/api/content/check', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const submitRequest = (body: SubmitBody) =>
  apiFetch<{ queryCode: string }>('/api/request', { method: 'POST', body: JSON.stringify(body) });

export const lookupRequest = (code: string) =>
  apiFetch<LookupResult>(
    `/api/requests/lookup?code=${encodeURIComponent(code.trim().toUpperCase())}`
  );

/** 试听走后端代理，前台拿不到平台直链 */
export const streamUrl = (source: SourceId, platformId: string) =>
  `/api/stream/${source}/${encodeURIComponent(platformId)}`;

export const fetchRecentPlaylist = () => apiFetch<PlaylistDay[]>('/api/playlist/recent');

export const fetchPlaylistDate = (date: string) =>
  apiFetch<PlaylistDay>(`/api/playlist/date/${date}`);
