import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sqlite } from './db';
import { songRequest, schedule, broadcastSlot } from './schema';
import { GRADE_LABELS, encodeWordList, isGrade, isRequestStatus } from './domain';
import type { Grade, RequestStatus, SourceId } from './domain';
import { badRequest, notFound, tooMany } from './errors';
import { IP_DAILY_LIMIT, IDENTITY_DAILY_LIMIT } from './rate-limits';
import { shanghaiDayStart } from './time';
import { isValid6DigitCode } from './runtime';
import { getSource } from './music-sources';
import { findBannedHits } from './banned-words';
import { readSite } from './site';

/**
 * sane regex safe hex (removes 0 O 1 I L)
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function newQueryCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';

export function normalizeIdentity(
  input: Record<string, unknown>,
  required: boolean,
  classCounts: Record<Grade, number>
): { grade: Grade; classNo: number; requesterName: string } | null {
  const filled = input.grade != null || input.classNo != null || input.requesterName != null;

  if (!required) {
    if (filled) throw badRequest('IDENTITY_NOT_REQUIRED', '现在是匿名点歌，不用填身份');
    return null;
  }

  const grade = input.grade;
  if (!isGrade(grade)) throw badRequest('BAD_GRADE', '年级没选对');
  const max = classCounts[grade];
  const classNo = Number(input.classNo);
  if (typeof classNo !== 'number' || !Number.isInteger(classNo) || classNo < 1 || classNo > max) {
    throw badRequest('BAD_CLASS', `${GRADE_LABELS[grade]}的班级要在 1 到 ${max} 之间`);
  }
  if (typeof input.requesterName !== 'string') throw badRequest('BAD_NAME', '姓名填 2 到 12 个字');
  const requesterName = input.requesterName.trim();
  if (requesterName.length < 2 || requesterName.length > 12) {
    throw badRequest('BAD_NAME', '姓名填 2 到 12 个字');
  }
  return { grade, classNo, requesterName };
}

export function assertDailyLimits(ipUsed: number, identityUsed: number | null): void {
  if (ipUsed >= IP_DAILY_LIMIT) {
    throw tooMany('RATE_LIMIT_IP', '请求数已达上限，请稍后再试', {
      limit: IP_DAILY_LIMIT,
      window: 'day',
    });
  }
  if (identityUsed !== null && identityUsed >= IDENTITY_DAILY_LIMIT) {
    throw tooMany('RATE_LIMIT_IDENTITY', `每人每天最多点 ${IDENTITY_DAILY_LIMIT} 首，明天再来`, {
      limit: IDENTITY_DAILY_LIMIT,
      window: 'day',
    });
  }
}

export async function submitRequest(
  input: Record<string, unknown>,
  ip: string,
  userAgent?: string
): Promise<{ queryCode: string }> {
  const site = await readSite();
  if (!site.requestsOpen) throw badRequest('REQUESTS_CLOSED', '点歌通道现在关着，等台里再开');

  const source = getSource(input.source);
  if (!source) throw badRequest('BAD_SOURCE', '音源不对');
  if (typeof input.platformId !== 'string' || !input.platformId.trim())
    throw badRequest('BAD_SONG', '没选歌');

  const identity = normalizeIdentity(input, site.requireIdentity, site.classCounts);

  // Prefer server-verified metadata; fall back to client data for sources without detail API (e.g. kugou)
  let song = await source.detail(input.platformId.trim());
  if (!song) {
    if (input.source !== 'kugou') throw notFound('SONG_NOT_FOUND', '这首歌查不到了，换一首试试');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 160) {
      throw notFound('SONG_NOT_FOUND', '这首歌查不到了，换一首试试');
    }
    const artist = typeof input.artist === 'string' ? input.artist.trim() : '';
    const album = typeof input.album === 'string' ? input.album.trim() : '';
    const durationMs = Number(input.durationMs);
    const coverUrl = typeof input.coverUrl === 'string' ? input.coverUrl : undefined;
    if (
      artist.length > 160 ||
      album.length > 160 ||
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      durationMs > 30 * 60_000 ||
      (coverUrl && coverUrl.length > 2048)
    ) {
      throw badRequest('BAD_SONG', '歌曲信息无效');
    }
    song = {
      source: 'kugou',
      platformId: input.platformId.trim(),
      title: input.title.trim(),
      artist: artist || '未知歌手',
      album: album || undefined,
      durationMs,
      coverUrl,
      vip: false,
    };
  }

  const flagged = await findBannedHits(song.title, song.artist, identity?.requesterName);
  if (flagged.length > 0) {
    throw badRequest('CONTENT_BLOCKED', '提交内容不符合规范，请更换后再试');
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const qc = newQueryCode();
      const since = Math.floor(shanghaiDayStart().getTime() / 1000);
      sqlite.transaction(() => {
        const ipUsed = (
          sqlite
            .prepare(
              'SELECT COUNT(*) AS "count" FROM "SongRequest" WHERE "submitIp" = ? AND "createdAt" >= ?'
            )
            .get(ip, since) as { count: number }
        ).count;
        const identityUsed = identity
          ? (
              sqlite
                .prepare(
                  'SELECT COUNT(*) AS "count" FROM "SongRequest" WHERE "grade" = ? AND "classNo" = ? AND "requesterName" = ? AND "createdAt" >= ?'
                )
                .get(identity.grade, identity.classNo, identity.requesterName, since) as {
                count: number;
              }
            ).count
          : null;
        assertDailyLimits(ipUsed, identityUsed);
        sqlite
          .prepare(
            'INSERT INTO "SongRequest" ("id", "queryCode", "source", "platformId", "title", "artist", "album", "durationMs", "coverUrl", "grade", "classNo", "requesterName", "flaggedWords", "submitIp", "submitUserAgent") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            `req_${crypto.randomUUID().substring(2, 11)}`,
            qc,
            song.source,
            song.platformId,
            song.title,
            song.artist,
            song.album ?? null,
            song.durationMs,
            song.coverUrl ?? null,
            identity?.grade ?? null,
            identity?.classNo ?? null,
            identity?.requesterName ?? null,
            encodeWordList(flagged),
            ip,
            userAgent ?? null
          );
      })();
      return { queryCode: qc };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw badRequest('CODE_COLLISION', '查询码生成失败，再点一次试试');
}

export interface LookupView {
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

export async function lookupByCode(code: string): Promise<LookupView> {
  if (!isValid6DigitCode(code)) throw badRequest('BAD_CODE', '查询码是 6 位字母数字');

  const rows = await db
    .select({
      id: songRequest.id,
      queryCode: songRequest.queryCode,
      status: songRequest.status,
      source: songRequest.source,
      title: songRequest.title,
      artist: songRequest.artist,
      coverUrl: songRequest.coverUrl,
      durationMs: songRequest.durationMs,
      createdAt: songRequest.createdAt,
      rejectReason: songRequest.rejectReason,
      schedulePlayDate: schedule.playDate,
      scheduleOrderNo: schedule.orderNo,
      slotName: broadcastSlot.name,
    })
    .from(songRequest)
    .leftJoin(schedule, eq(songRequest.id, schedule.requestId))
    .leftJoin(broadcastSlot, eq(schedule.slotId, broadcastSlot.id))
    .where(eq(songRequest.queryCode, code))
    .limit(1);

  if (rows.length === 0) throw notFound('CODE_NOT_FOUND', '没找到这个查询码，看看是不是输错了');
  const row = rows[0] as any;

  const status = isRequestStatus(row.status) ? (row.status as RequestStatus) : 'PENDING';
  return {
    queryCode: row.queryCode,
    status,
    statusLabel: status,
    source: row.source,
    title: row.title,
    artist: row.artist,
    coverUrl: row.coverUrl,
    durationMs: row.durationMs,
    createdAt: new Date(Number(row.createdAt) * 1000).toISOString(),
    rejectReason: row.rejectReason,
    schedule: row.schedulePlayDate
      ? {
          playDate: row.schedulePlayDate,
          slotName: row.slotName,
          orderNo: row.scheduleOrderNo,
        }
      : null,
  };
}
