/**
 * Domain-agnostic constants and validators.
 * In a production deployment this source would be pulled from the DB (siteSetting),
 * but for SPA-mode here we use global defaults. A future admin UI could decouple
 * this file from the build.
 */

export const SOURCES = ['netease', 'qq', 'kugou'] as const;
export type SourceId = (typeof SOURCES)[number];

export const GRADES = ['G1', 'G2', 'G3'] as const;
export type Grade = (typeof GRADES)[number];
export const GRADE_LABELS: Record<Grade, string> = { G1: '高一', G2: '高二', G3: '高三' };

export const REQUEST_STATUSES = ['PENDING', 'SCHEDULED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: '待审核',
  SCHEDULED: '已排期',
  REJECTED: '已驳回',
  CANCELLED: '已取消',
};

export const PLAYBACK_STATUSES = [
  'PENDING_DOWNLOAD',
  'DOWNLOADED',
  'PLAYED',
  'PLAYBACK_ERROR',
] as const;
export type PlaybackStatus = (typeof PLAYBACK_STATUSES)[number];
export const PLAYBACK_STATUS_LABELS: Record<PlaybackStatus, string> = {
  PENDING_DOWNLOAD: '待下载',
  DOWNLOADED: '已下载',
  PLAYED: '已播放',
  PLAYBACK_ERROR: '播放异常',
};

export const DAY_KINDS = ['SCHOOL', 'OFF', 'EXAM_NO_BROADCAST'] as const;
export type DayKind = (typeof DAY_KINDS)[number];
export const DAY_KIND_LABELS: Record<DayKind, string> = {
  SCHOOL: '上学',
  OFF: '不上学',
  EXAM_NO_BROADCAST: '考试不播',
};

export const ADMIN_ROLES = ['SUPER', 'PLANNER', 'TECHNICIAN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER: '超级管理员',
  PLANNER: '策划',
  TECHNICIAN: '技术员',
};

const membership =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

export const isSource = membership(SOURCES);
export const isGrade = membership(GRADES);
export const isRequestStatus = membership(REQUEST_STATUSES);
export const isPlaybackStatus = membership(PLAYBACK_STATUSES);
export const isDayKind = membership(DAY_KINDS);
export const isAdminRole = membership(ADMIN_ROLES);

export function decodeWordList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function encodeWordList(words: readonly string[]): string {
  return JSON.stringify([...new Set(words.map((word) => word.trim()).filter(Boolean))]);
}

export function decodeDetail(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

export function encodeDetail(detail: unknown): string | null {
  return detail === undefined || detail === null ? null : JSON.stringify(detail);
}

export const decodeBool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === 'true';

export const encodeBool = (value: boolean): string => (value ? 'true' : 'false');

export const decodeInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
