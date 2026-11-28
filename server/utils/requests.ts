import { randomInt } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { db, sqlite } from './db';
import { songRequest, schedule, broadcastSlot } from './schema';
import { GRADE_LABELS, STATUS_LABELS, encodeWordList, isGrade, isRequestStatus } from './domain';
import type { Grade, RequestStatus, SourceId } from './domain';
import { badRequest, notFound, tooMany } from './errors';
import {
  DEVICE_WEEKLY_LIMIT,
  IP_DAILY_LIMIT,
  IP_WEEKLY_LIMIT,
  isInternalRateLimitEnabled,
} from './rate-limits';
import { shanghaiDayStart, shanghaiWeekStart } from './time';
import { isValid6DigitCode } from './runtime';
import { getSource, sourceAllowsClientMetadata } from './music-sources';
import { findBannedHits, findContentScriptHits } from './banned-words';
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

export function assertDailyLimits(ipUsed: number): void {
  if (!isInternalRateLimitEnabled()) return;
  if (ipUsed >= IP_DAILY_LIMIT) {
    throw tooMany('RATE_LIMIT_IP', '请求数已达上限，请稍后再试', {
      limit: IP_DAILY_LIMIT,
      window: 'day',
    });
  }
}

function assertNoActiveIdentityRequest(activeCount: number): void {
  if (activeCount > 0) {
    throw tooMany('REQUEST_CYCLE_ACTIVE', '你还有一首点歌正在等待播出，播出、驳回或取消后再来点歌');
  }
}

/**
 * 每周限额检查。匿名模式用设备令牌（每周 1 首）+ IP 兜底（每周 5 首，
 * 放宽是因为校园 NAT 下多人共享出口 IP，只拦明显异常）；实名模式只靠 IP 兜底，
 * 身份维度的限制由 assertNoActiveIdentityRequest 的「同时只能一首在途」承担。
 */
function assertWeeklyLimits(deviceUsed: number, ipWeekUsed: number, anonymous: boolean): void {
  if (!isInternalRateLimitEnabled()) return;
  if (anonymous && deviceUsed >= DEVICE_WEEKLY_LIMIT) {
    throw tooMany('RATE_LIMIT_WEEK', '每人每周最多点一首歌，下周再来', {
      limit: DEVICE_WEEKLY_LIMIT,
      window: 'week',
    });
  }
  if (ipWeekUsed >= IP_WEEKLY_LIMIT) {
    throw tooMany('RATE_LIMIT_IP', '这个网络本周点歌次数已达上限，换个网络或下周再来', {
      limit: IP_WEEKLY_LIMIT,
      window: 'week',
    });
  }
}

export interface SubmitResult {
  queryCode: string;
  /** merged = 这首歌已有人在等：self 是本人重复点，other 是其他同学先点了 */
  merged: 'self' | 'other' | null;
}

export async function submitRequest(
  input: Record<string, unknown>,
  ip: string,
  userAgent?: string,
  deviceToken?: string | null
): Promise<SubmitResult> {
  const site = await readSite();
  if (!site.requestsOpen) throw badRequest('REQUESTS_CLOSED', '点歌通道现在关着，等台里再开');

  const source = getSource(input.source);
  if (!source) throw badRequest('BAD_SOURCE', '音源不对');
  if (typeof input.platformId !== 'string' || !input.platformId.trim())
    throw badRequest('BAD_SONG', '没选歌');
  const sourceId = input.source as SourceId;

  const identity = normalizeIdentity(input, site.requireIdentity, site.classCounts);

  // Prefer server-verified metadata; fall back to client data only when the platform's provider
  // does not advertise a metadata capability at all.
  let song = await source.detail(input.platformId.trim());
  if (!song) {
    if (!(await sourceAllowsClientMetadata(sourceId)))
      throw notFound('SONG_NOT_FOUND', '这首歌查不到了，换一首试试');
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
      source: sourceId,
      platformId: input.platformId.trim(),
      title: input.title.trim(),
      artist: artist || '未知歌手',
      album: album || undefined,
      durationMs,
      coverUrl,
      vip: false,
    };
  }

  const flagged = [
    ...(await findBannedHits(song.title, song.artist, identity?.requesterName)),
    ...findContentScriptHits(site, song.title, song.artist, identity?.requesterName),
  ];
  if (flagged.length > 0) {
    throw badRequest('CONTENT_BLOCKED', '提交内容不符合规范，请更换后再试');
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const qc = newQueryCode();
      const since = Math.floor(shanghaiDayStart().getTime() / 1000);
      const weekSince = Math.floor(shanghaiWeekStart().getTime() / 1000);
      let mergedResult: SubmitResult | null = null;
      sqlite.transaction(() => {
        // 同一首歌已有人在等：不新增记录，直接把组里最早的活跃查询码还给学生。
        // 先查自己有没有点过——自己重复点给 self 提示；别人先点的也算并入，不消耗本周名额。
        const existing = sqlite
          .prepare(
            'SELECT r."queryCode", r."submitDevice", r."submitIp" FROM "SongRequest" r\n' +
              'JOIN "SongRequestGroup" g ON r."groupId" = g."id"\n' +
              'WHERE g."source" = ? AND g."platformId" = ? AND\n' +
              '(r."status" = \'PENDING\' OR (r."status" = \'SCHEDULED\' AND r."playbackStatus" != \'PLAYED\'))\n' +
              'ORDER BY r."createdAt" ASC LIMIT 1'
          )
          .get(song.source, song.platformId) as
          { queryCode: string; submitDevice: string | null; submitIp: string } | undefined;
        if (existing) {
          const isSelf =
            (deviceToken != null && existing.submitDevice === deviceToken) ||
            existing.submitIp === ip;
          mergedResult = { queryCode: existing.queryCode, merged: isSelf ? 'self' : 'other' };
          return;
        }

        const ipUsed = (
          sqlite
            .prepare(
              'SELECT COUNT(*) AS "count" FROM "SongRequest" WHERE "submitIp" = ? AND "createdAt" >= ?'
            )
            .get(ip, since) as { count: number }
        ).count;
        assertDailyLimits(ipUsed);
        const anonymous = !identity;
        const deviceUsed =
          anonymous && deviceToken
            ? (
                sqlite
                  .prepare(
                    'SELECT COUNT(*) AS "count" FROM "SongRequest" WHERE "submitDevice" = ? AND "createdAt" >= ?'
                  )
                  .get(deviceToken, weekSince) as { count: number }
              ).count
            : 0;
        const ipWeekUsed = (
          sqlite
            .prepare(
              'SELECT COUNT(*) AS "count" FROM "SongRequest" WHERE "submitIp" = ? AND "createdAt" >= ?'
            )
            .get(ip, weekSince) as { count: number }
        ).count;
        assertWeeklyLimits(deviceUsed, ipWeekUsed, anonymous);
        if (identity) {
          const activeCount = (
            sqlite
              .prepare(
                'SELECT COUNT(*) AS "count" FROM "SongRequest" WHERE "grade" = ? AND "classNo" = ? AND "requesterName" = ? AND ("status" = ? OR ("status" = ? AND "playbackStatus" != ?))'
              )
              .get(
                identity.grade,
                identity.classNo,
                identity.requesterName,
                'PENDING',
                'SCHEDULED',
                'PLAYED'
              ) as { count: number }
          ).count;
          assertNoActiveIdentityRequest(activeCount);
        }
        const group = sqlite
          .prepare(
            'SELECT g."id" FROM "SongRequestGroup" g WHERE g."source" = ? AND g."platformId" = ? AND EXISTS (SELECT 1 FROM "SongRequest" r WHERE r."groupId" = g."id" AND (r."status" = ? OR (r."status" = ? AND r."playbackStatus" != ?))) ORDER BY g."createdAt" DESC LIMIT 1'
          )
          .get(song.source, song.platformId, 'PENDING', 'SCHEDULED', 'PLAYED') as
          { id: string } | undefined;
        const groupId = group?.id ?? `grp_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
        if (!group) {
          sqlite
            .prepare(
              'INSERT INTO "SongRequestGroup" ("id", "source", "platformId") VALUES (?, ?, ?)'
            )
            .run(groupId, song.source, song.platformId);
        }
        sqlite
          .prepare(
            'INSERT INTO "SongRequest" ("id", "queryCode", "source", "platformId", "groupId", "title", "artist", "album", "durationMs", "coverUrl", "grade", "classNo", "requesterName", "flaggedWords", "submitIp", "submitDevice", "submitUserAgent") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            `req_${crypto.randomUUID().substring(2, 11)}`,
            qc,
            song.source,
            song.platformId,
            groupId,
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
            deviceToken ?? null,
            userAgent ?? null
          );
      })();
      if (mergedResult) return mergedResult;
      return { queryCode: qc, merged: null };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw badRequest('CODE_COLLISION', '查询码生成失败，再点一次试试');
}

export interface RequestStatsView {
  /** 库里全部点歌记录数 */
  total: number;
  /** 已通过并排进播出单的，状态为 SCHEDULED */
  approved: number;
  /** 被驳回的 */
  rejected: number;
}

/** 首页那句「点歌概况」用的一次性汇总，只暴露数量，不含任何歌曲或点歌人信息 */
export async function readRequestStats(): Promise<RequestStatsView> {
  const rows = await db
    .select({ status: songRequest.status, count: count() })
    .from(songRequest)
    .groupBy(songRequest.status);

  let total = 0;
  let approved = 0;
  let rejected = 0;
  for (const row of rows) {
    const value = Number(row.count);
    total += value;
    if (row.status === 'SCHEDULED') approved = value;
    else if (row.status === 'REJECTED') rejected = value;
  }
  return { total, approved, rejected };
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
    statusLabel: STATUS_LABELS[status],
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
