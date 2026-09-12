import { createHash, randomUUID } from 'node:crypto';
import { sqlite } from './db';
import { badRequest, tooMany } from './errors';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const REQUESTS_PER_HOUR = 5;
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_COOLDOWN_SECONDS = 15 * 60;

export interface RequestContext {
  source: unknown;
  platformId: unknown;
  title: unknown;
  artist: unknown;
  album: unknown;
  durationMs: unknown;
  grade: unknown;
  classNo: unknown;
  requesterName: unknown;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestContextHash(input: RequestContext): string {
  return hash(
    JSON.stringify({
      source: typeof input.source === 'string' ? input.source : '',
      platformId: typeof input.platformId === 'string' ? input.platformId.trim() : '',
      title: typeof input.title === 'string' ? input.title.trim() : '',
      artist: typeof input.artist === 'string' ? input.artist.trim() : '',
      album: typeof input.album === 'string' ? input.album.trim() : '',
      durationMs: Number(input.durationMs) || 0,
      grade: typeof input.grade === 'string' ? input.grade : '',
      classNo: Number(input.classNo) || 0,
      requesterName: typeof input.requesterName === 'string' ? input.requesterName.trim() : '',
    })
  );
}

function ipHash(ip: string): string {
  return hash(`request-ip:${ip}`);
}

function difficultyFor(count: number): number {
  return count >= 3 ? 5 : 4;
}

export function createPowChallenge(
  contextHash: string,
  ip: string
): {
  challengeId: string;
  difficulty: number;
  expiresAt: number;
} {
  if (!/^[a-f0-9]{64}$/.test(contextHash))
    throw badRequest('BAD_CHALLENGE_CONTEXT', '提交信息无效');

  const now = Math.floor(Date.now() / 1000);
  const hourStart = now - (now % 3600);
  const key = `ip:${ipHash(ip)}`;
  const record = sqlite
    .prepare(
      'SELECT "windowStart", "count", "blockedUntil" FROM "RequestRateLimit" WHERE "key" = ?'
    )
    .get(key) as { windowStart: number; count: number; blockedUntil: number | null } | undefined;
  if (record?.blockedUntil && record.blockedUntil > now) {
    throw tooMany('POW_COOLDOWN', '验证失败次数过多，请稍后再试');
  }
  const count = record?.windowStart === hourStart ? record.count : 0;
  if (count >= REQUESTS_PER_HOUR) {
    throw tooMany('RATE_LIMIT_IP', '请求数已达上限，请稍后再试', {
      limit: REQUESTS_PER_HOUR,
      window: 'hour',
    });
  }

  const challengeId = `pow_${randomUUID().replace(/-/g, '')}`;
  const expiresAt = now + CHALLENGE_TTL_SECONDS;
  sqlite
    .prepare(
      'INSERT INTO "PowChallenge" ("id", "contextHash", "ipHash", "difficulty", "expiresAt") VALUES (?, ?, ?, ?, ?)'
    )
    .run(challengeId, contextHash, ipHash(ip), difficultyFor(count), expiresAt);
  return { challengeId, difficulty: difficultyFor(count), expiresAt };
}

export function verifyAndConsumePow(
  input: RequestContext & { challengeId?: unknown; nonce?: unknown; contextHash?: unknown },
  ip: string
): void {
  if (
    typeof input.challengeId !== 'string' ||
    typeof input.nonce !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.contextHash as string) ||
    input.nonce.length > 128
  ) {
    throw badRequest('POW_REQUIRED', '请完成浏览器验证后再提交');
  }
  const challengeId = input.challengeId;
  const nonce = input.nonce;
  const contextHash = input.contextHash;

  const now = Math.floor(Date.now() / 1000);
  const expectedContextHash = requestContextHash(input);
  if (contextHash !== expectedContextHash) {
    throw badRequest('POW_CONTEXT_MISMATCH', '提交内容已变更，请重新验证');
  }

  const key = `ip:${ipHash(ip)}`;
  const transaction = sqlite.transaction(() => {
    const challenge = sqlite
      .prepare(
        'SELECT "contextHash", "ipHash", "difficulty", "expiresAt", "usedAt", "failedAttempts" FROM "PowChallenge" WHERE "id" = ?'
      )
      .get(challengeId) as
      | {
          contextHash: string;
          ipHash: string;
          difficulty: number;
          expiresAt: number;
          usedAt: number | null;
          failedAttempts: number;
        }
      | undefined;
    if (
      !challenge ||
      challenge.expiresAt <= now ||
      challenge.usedAt ||
      challenge.ipHash !== ipHash(ip)
    ) {
      throw badRequest('POW_EXPIRED', '验证已过期，请重新提交');
    }
    if (challenge.contextHash !== contextHash) {
      throw badRequest('POW_CONTEXT_MISMATCH', '提交内容已变更，请重新验证');
    }

    const proof = hash(`${challengeId}:${contextHash}:${nonce}`);
    if (!proof.startsWith('0'.repeat(challenge.difficulty))) {
      const failedAttempts = challenge.failedAttempts + 1;
      sqlite
        .prepare('UPDATE "PowChallenge" SET "failedAttempts" = ? WHERE "id" = ?')
        .run(failedAttempts, challengeId);
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        sqlite
          .prepare(
            'INSERT INTO "RequestRateLimit" ("key", "windowStart", "count", "blockedUntil") VALUES (?, ?, 0, ?) ON CONFLICT("key") DO UPDATE SET "blockedUntil" = excluded."blockedUntil"'
          )
          .run(key, now - (now % 3600), now + FAILURE_COOLDOWN_SECONDS);
      }
      throw badRequest('POW_INVALID', '浏览器验证失败，请重新提交');
    }

    const nonceHash = hash(nonce);
    try {
      sqlite
        .prepare('INSERT INTO "PowNonce" ("challengeId", "nonceHash") VALUES (?, ?)')
        .run(challengeId, nonceHash);
    } catch {
      throw badRequest('POW_REPLAYED', '验证已使用，请重新提交');
    }
    const rate = sqlite
      .prepare(
        'SELECT "windowStart", "count", "blockedUntil" FROM "RequestRateLimit" WHERE "key" = ?'
      )
      .get(key) as { windowStart: number; count: number; blockedUntil: number | null } | undefined;
    if (rate?.blockedUntil && rate.blockedUntil > now) {
      throw tooMany('POW_COOLDOWN', '验证失败次数过多，请稍后再试');
    }
    const hourStart = now - (now % 3600);
    const used = rate?.windowStart === hourStart ? rate.count : 0;
    if (used >= REQUESTS_PER_HOUR) {
      throw tooMany('RATE_LIMIT_IP', '请求数已达上限，请稍后再试');
    }
    sqlite
      .prepare(
        'INSERT INTO "RequestRateLimit" ("key", "windowStart", "count", "blockedUntil") VALUES (?, ?, 1, NULL) ON CONFLICT("key") DO UPDATE SET "windowStart" = excluded."windowStart", "count" = CASE WHEN "RequestRateLimit"."windowStart" = excluded."windowStart" THEN "RequestRateLimit"."count" + 1 ELSE 1 END, "blockedUntil" = NULL'
      )
      .run(key, hourStart);
    sqlite.prepare('UPDATE "PowChallenge" SET "usedAt" = ? WHERE "id" = ?').run(now, challengeId);
  });
  transaction();
}

export function cleanupRequestProtection(): void {
  const now = Math.floor(Date.now() / 1000);
  sqlite.prepare('DELETE FROM "PowChallenge" WHERE "expiresAt" < ?').run(now - 24 * 60 * 60);
  sqlite.prepare('DELETE FROM "PowNonce" WHERE "usedAt" < ?').run(now - 24 * 60 * 60);
  sqlite
    .prepare(
      'DELETE FROM "RequestRateLimit" WHERE "windowStart" < ? AND ("blockedUntil" IS NULL OR "blockedUntil" < ?)'
    )
    .run(now - 7 * 24 * 60 * 60, now);
}
