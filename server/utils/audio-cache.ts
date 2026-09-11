import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db, sqlite } from './db';
import { audioCacheObject, songRequest } from './schema';
import { eq } from 'drizzle-orm';
import { badRequest, notFound } from './errors';

const CACHE_DIR = path.join(process.cwd(), 'data', 'audio-cache');
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_BYTES = Number(process.env.MUSIC_DOWNLOAD_MAX_BYTES ?? 30 * 1024 * 1024);

export interface CachedAudio {
  body: Buffer;
  mimeType: string;
  fileName: string;
}

function trustedHosts(): Set<string> {
  return new Set(
    (process.env.MUSIC_DOWNLOAD_TRUSTED_HOSTS ?? '')
      .split(',')
      .map((host: string) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function safeFileName(value: string): string {
  return (
    value
      .split('')
      .filter((character) => character >= ' ' && !'\\/:*?"<>|'.includes(character))
      .join('')
      .trim()
      .slice(0, 120) || 'audio'
  );
}

export function recordSystemAlert(
  level: 'warning' | 'error',
  message: string,
  detail?: unknown
): void {
  sqlite
    .prepare(
      'INSERT INTO "SystemAlert" ("id", "level", "message", "detail", "createdAt") VALUES (?, ?, ?, ?, unixepoch())'
    )
    .run(
      `alert_${randomBytes(8).toString('hex')}`,
      level,
      message,
      detail ? JSON.stringify(detail) : null
    );
}

async function readCached(requestId: string, title: string): Promise<CachedAudio | null> {
  const row = await db
    .select()
    .from(audioCacheObject)
    .where(eq(audioCacheObject.requestId, requestId))
    .limit(1);
  if (!row[0]) return null;
  try {
    const body = await readFile(row[0].filePath);
    await db
      .update(audioCacheObject)
      .set({ lastAccessAt: Math.floor(Date.now() / 1000) })
      .where(eq(audioCacheObject.requestId, requestId));
    return { body, mimeType: row[0].mimeType, fileName: `${safeFileName(title)}.mp3` };
  } catch {
    await db.delete(audioCacheObject).where(eq(audioCacheObject.requestId, requestId));
    return null;
  }
}

function requireDownloadUrl(source: string, platformId: string): URL {
  const raw = process.env[`MUSIC_DOWNLOAD_URL_${source.toUpperCase()}`];
  if (!raw) throw badRequest('DOWNLOAD_UNAVAILABLE', '该音源未配置受控下载地址');
  let target: URL;
  try {
    target = new URL(raw.replace('{id}', encodeURIComponent(platformId)));
  } catch {
    throw badRequest('DOWNLOAD_UNAVAILABLE', '音源下载地址配置无效');
  }
  const hosts = trustedHosts();
  if (target.protocol !== 'https:' || !hosts.has(target.hostname.toLowerCase())) {
    throw badRequest('DOWNLOAD_UNAVAILABLE', '音源下载地址不在可信范围内');
  }
  return target;
}

async function downloadAudio(
  source: string,
  platformId: string
): Promise<{ body: Buffer; mimeType: string }> {
  const target = requireDownloadUrl(source, platformId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: { 'user-agent': 'CampusRadio/1.0' },
    });
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (
      !response.ok ||
      !response.body ||
      !contentType.startsWith('audio/') ||
      contentLength > MAX_BYTES
    ) {
      throw badRequest('DOWNLOAD_UNAVAILABLE', '音源未返回可用音频');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw badRequest('DOWNLOAD_TOO_LARGE', '音频文件超过大小限制');
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks), mimeType: contentType };
  } finally {
    clearTimeout(timer);
  }
}

async function saveCached(requestId: string, body: Buffer, mimeType: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const filePath = path.join(
    CACHE_DIR,
    `${createHash('sha256').update(requestId).digest('hex')}.audio`
  );
  const tempPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tempPath, body, { mode: 0o600 });
  await rename(tempPath, filePath);
  sqlite
    .prepare(
      `INSERT INTO "AudioCacheObject" ("requestId", "filePath", "mimeType", "sizeBytes", "createdAt", "lastAccessAt")
      VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT("requestId") DO UPDATE SET "filePath" = excluded."filePath", "mimeType" = excluded."mimeType", "sizeBytes" = excluded."sizeBytes", "lastAccessAt" = excluded."lastAccessAt"`
    )
    .run(requestId, filePath, mimeType, body.length);
  return filePath;
}

export async function getRequestAudio(requestId: string): Promise<CachedAudio> {
  const request = await db.select().from(songRequest).where(eq(songRequest.id, requestId)).limit(1);
  if (!request[0]) throw notFound('REQUEST_NOT_FOUND', '找不到点歌记录');
  const cached = await readCached(requestId, request[0].title);
  if (cached) return cached;
  try {
    const downloaded = await downloadAudio(request[0].source, request[0].platformId);
    await saveCached(requestId, downloaded.body, downloaded.mimeType);
    return { ...downloaded, fileName: `${safeFileName(request[0].title)}.mp3` };
  } catch (error) {
    recordSystemAlert('error', '音频下载失败', {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function removeCachedAudio(requestId: string): Promise<void> {
  const row = await db
    .select()
    .from(audioCacheObject)
    .where(eq(audioCacheObject.requestId, requestId))
    .limit(1);
  if (!row[0]) return;
  await rm(row[0].filePath, { force: true });
  await db.delete(audioCacheObject).where(eq(audioCacheObject.requestId, requestId));
}

export async function cacheStats(): Promise<{ count: number; bytes: number }> {
  const rows = sqlite
    .prepare(
      'SELECT COUNT(*) AS "count", COALESCE(SUM("sizeBytes"), 0) AS "bytes" FROM "AudioCacheObject"'
    )
    .get() as { count: number; bytes: number };
  return rows;
}
