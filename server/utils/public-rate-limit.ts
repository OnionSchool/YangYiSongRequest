import { createHash } from 'node:crypto';
import { sqlite } from './db';
import { tooMany } from './errors';

function hashIp(ip: string): string {
  return createHash('sha256').update(`public-rate-limit-ip:${ip}`).digest('hex');
}

export function consumePublicRateLimit(
  namespace: string,
  ip: string,
  max: number,
  windowSeconds: number
): void {
  const current = Math.floor(Date.now() / 1000);
  const windowStart = current - (current % windowSeconds);
  const key = `${namespace}:${hashIp(ip)}`;
  sqlite.transaction(() => {
    const record = sqlite
      .prepare('SELECT "windowStart", "count" FROM "RequestRateLimit" WHERE "key" = ?')
      .get(key) as { windowStart: number; count: number } | undefined;
    const count = record?.windowStart === windowStart ? record.count : 0;
    if (count >= max) {
      throw tooMany('RATE_LIMIT_IP', '请求过于频繁，请稍后再试', { max, windowSeconds });
    }
    sqlite
      .prepare(
        'INSERT INTO "RequestRateLimit" ("key", "windowStart", "count", "blockedUntil") VALUES (?, ?, 1, NULL) ON CONFLICT("key") DO UPDATE SET "windowStart" = excluded."windowStart", "count" = CASE WHEN "RequestRateLimit"."windowStart" = excluded."windowStart" THEN "RequestRateLimit"."count" + 1 ELSE 1 END, "blockedUntil" = NULL'
      )
      .run(key, windowStart);
  })();
}
