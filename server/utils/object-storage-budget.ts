import { randomBytes } from 'node:crypto';
import { sqlite } from './db';

const DEFAULT_CLASS_A_LIMIT = 900_000;
const DEFAULT_CLASS_B_LIMIT = 9_000_000;
const DEFAULT_STORAGE_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;

function readLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() &&
    process.env.S3_REGION?.trim() &&
    process.env.S3_BUCKET?.trim() &&
    process.env.S3_ACCESS_KEY_ID?.trim() &&
    process.env.S3_SECRET_ACCESS_KEY?.trim()
  );
}

function period(): string {
  return new Date().toISOString().slice(0, 7);
}

function insertAlert(message: string, detail: Record<string, unknown>): void {
  sqlite
    .prepare(
      'INSERT INTO "SystemAlert" ("id", "level", "message", "detail", "createdAt") VALUES (?, ?, ?, ?, unixepoch())'
    )
    .run(`alert_${randomBytes(8).toString('hex')}`, 'warning', message, JSON.stringify(detail));
}

const alerted = new Set<string>();

function alertOnce(key: string, message: string, detail: Record<string, unknown>): void {
  if (alerted.has(key)) return;
  alerted.add(key);
  try {
    insertAlert(message, detail);
  } catch {
    // 告警写入失败时仍保持额度阻断。
  }
}

function usageFor(currentPeriod: string): { classAOperations: number; classBOperations: number } {
  return (
    (sqlite
      .prepare(
        'SELECT "classAOperations", "classBOperations" FROM "ObjectStorageMonthlyUsage" WHERE "period" = ?'
      )
      .get(currentPeriod) as
      { classAOperations: number; classBOperations: number } | undefined) ?? {
      classAOperations: 0,
      classBOperations: 0,
    }
  );
}

function trackedBytes(): number {
  return (
    (
      sqlite.prepare('SELECT "trackedBytes" FROM "ObjectStorageState" WHERE "id" = 1').get() as
        { trackedBytes: number } | undefined
    )?.trackedBytes ?? 0
  );
}

function limits() {
  return {
    classALimit: readLimit('S3_MONTHLY_CLASS_A_LIMIT', DEFAULT_CLASS_A_LIMIT),
    classBLimit: readLimit('S3_MONTHLY_CLASS_B_LIMIT', DEFAULT_CLASS_B_LIMIT),
    storageLimitBytes: readLimit('S3_STORAGE_LIMIT_BYTES', DEFAULT_STORAGE_LIMIT_BYTES),
    reservedStorageBytes: readLimit('S3_STORAGE_RESERVED_BYTES', 0),
  };
}

export interface ObjectStorageBudgetStatus {
  enabled: boolean;
  period: string;
  classAOperations: number;
  classALimit: number;
  classBOperations: number;
  classBLimit: number;
  trackedBytes: number;
  reservedStorageBytes: number;
  storageLimitBytes: number;
}

export function objectStorageBudgetStatus(): ObjectStorageBudgetStatus {
  const currentPeriod = period();
  const usage = usageFor(currentPeriod);
  const config = limits();
  return {
    enabled: isConfigured(),
    period: currentPeriod,
    ...usage,
    trackedBytes: trackedBytes(),
    ...config,
  };
}

export function reserveObjectStorageRead(): boolean {
  if (!isConfigured()) return false;
  const currentPeriod = period();
  const config = limits();
  try {
    return sqlite.transaction(() => {
      const usage = usageFor(currentPeriod);
      if (usage.classBOperations >= config.classBLimit) {
        alertOnce(`${currentPeriod}:read`, '对象存储读取额度已用尽，已停止访问对象存储', {
          period: currentPeriod,
          limit: config.classBLimit,
        });
        return false;
      }
      sqlite
        .prepare(
          `INSERT INTO "ObjectStorageMonthlyUsage" ("period", "classAOperations", "classBOperations")
          VALUES (?, 0, 1)
          ON CONFLICT("period") DO UPDATE SET "classBOperations" = "classBOperations" + 1`
        )
        .run(currentPeriod);
      return true;
    })();
  } catch {
    return false;
  }
}

export function reserveObjectStorageWrite(objectKey: string, sizeBytes: number): boolean {
  if (!isConfigured() || sizeBytes < 0) return false;
  const currentPeriod = period();
  const config = limits();
  try {
    return sqlite.transaction(() => {
      const usage = usageFor(currentPeriod);
      const existing = sqlite
        .prepare('SELECT "sizeBytes" FROM "ObjectStorageObject" WHERE "objectKey" = ?')
        .get(objectKey) as { sizeBytes: number } | undefined;
      const nextBytes = trackedBytes() - (existing?.sizeBytes ?? 0) + sizeBytes;
      if (usage.classAOperations >= config.classALimit) {
        alertOnce(`${currentPeriod}:write`, '对象存储写入额度已用尽，已停止写入对象存储', {
          period: currentPeriod,
          limit: config.classALimit,
        });
        return false;
      }
      if (nextBytes + config.reservedStorageBytes > config.storageLimitBytes) {
        alertOnce(`${currentPeriod}:storage`, '对象存储缓存容量已达上限，已停止写入对象存储', {
          limit: config.storageLimitBytes,
          reserved: config.reservedStorageBytes,
        });
        return false;
      }
      sqlite
        .prepare(
          `INSERT INTO "ObjectStorageMonthlyUsage" ("period", "classAOperations", "classBOperations")
          VALUES (?, 1, 0)
          ON CONFLICT("period") DO UPDATE SET "classAOperations" = "classAOperations" + 1`
        )
        .run(currentPeriod);
      sqlite
        .prepare(
          `INSERT INTO "ObjectStorageObject" ("objectKey", "sizeBytes") VALUES (?, ?)
          ON CONFLICT("objectKey") DO UPDATE SET "sizeBytes" = excluded."sizeBytes"`
        )
        .run(objectKey, sizeBytes);
      sqlite
        .prepare(
          `INSERT INTO "ObjectStorageState" ("id", "trackedBytes") VALUES (1, ?)
          ON CONFLICT("id") DO UPDATE SET "trackedBytes" = excluded."trackedBytes"`
        )
        .run(nextBytes);
      return true;
    })();
  } catch {
    return false;
  }
}

export function releaseObjectStorageObject(objectKey: string): void {
  try {
    sqlite.transaction(() => {
      const existing = sqlite
        .prepare('SELECT "sizeBytes" FROM "ObjectStorageObject" WHERE "objectKey" = ?')
        .get(objectKey) as { sizeBytes: number } | undefined;
      if (!existing) return;
      sqlite.prepare('DELETE FROM "ObjectStorageObject" WHERE "objectKey" = ?').run(objectKey);
      sqlite
        .prepare(
          `INSERT INTO "ObjectStorageState" ("id", "trackedBytes") VALUES (1, 0)
          ON CONFLICT("id") DO UPDATE SET "trackedBytes" = MAX(0, "trackedBytes" - ?)`
        )
        .run(existing.sizeBytes);
    })();
  } catch {
    // 对象已删除但本地统计未更新时，宁可保守阻断后续写入。
  }
}
