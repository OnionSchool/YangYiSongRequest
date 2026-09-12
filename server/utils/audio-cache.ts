import { createHash, randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db, sqlite } from './db';
import { audioCacheObject, songRequest } from './schema';
import { eq } from 'drizzle-orm';
import { badRequest, notFound } from './errors';
import { readDownloadTemplates } from './download-config';
import { fetchAudioUrl } from './music-sources';
import type { SourceId } from './domain';
import { fetchExternal, validateExternalUrl } from './external-url';

const CACHE_DIR = path.join(process.cwd(), 'data', 'audio-cache');
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_BYTES = Number(process.env.MUSIC_DOWNLOAD_MAX_BYTES ?? 30 * 1024 * 1024);
const S3_PREFIX = 's3://';

interface S3CacheConfig {
  client: S3Client;
  bucket: string;
}

function getS3CacheConfig(): S3CacheConfig | null {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region = process.env.S3_REGION?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint && !region && !bucket && !accessKeyId && !secretAccessKey) return null;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    recordSystemAlert('warning', 'S3 音频缓存配置不完整，已使用本地缓存');
    return null;
  }
  return {
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

const s3Cache = getS3CacheConfig();

function s3ObjectKey(requestId: string): string {
  return `audio-cache/${createHash('sha256').update(requestId).digest('hex')}.audio`;
}

function s3Path(key: string): string {
  return `${S3_PREFIX}${key}`;
}

function s3Key(filePath: string): string | null {
  return filePath.startsWith(S3_PREFIX) ? filePath.slice(S3_PREFIX.length) : null;
}

async function streamToBuffer(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error('S3 缓存音频超过大小限制');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export interface CachedAudio {
  body: Buffer;
  mimeType: string;
  fileName: string;
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
    const key = s3Key(row[0].filePath);
    const body =
      key && s3Cache
        ? await streamToBuffer(
            (await s3Cache.client.send(new GetObjectCommand({ Bucket: s3Cache.bucket, Key: key })))
              .Body as AsyncIterable<Uint8Array>
          )
        : await readFile(row[0].filePath);
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

async function resolveDownloadUrl(source: string, platformId: string): Promise<URL> {
  // 1. Try download template first
  const templates = await readDownloadTemplates();
  const raw = templates[source as keyof typeof templates];
  if (raw) {
    try {
      return await validateExternalUrl(raw.replaceAll('{id}', encodeURIComponent(platformId)));
    } catch {
      // template invalid, fall through to Meting
    }
  }

  // 2. Fall back to Meting API
  const metingUrl = await fetchAudioUrl(source as SourceId, platformId);
  if (metingUrl) {
    try {
      return await validateExternalUrl(metingUrl);
    } catch {
      // invalid URL from Meting
    }
  }

  throw badRequest('DOWNLOAD_UNAVAILABLE', '该音源无法获取下载地址');
}

async function downloadAudio(
  source: string,
  platformId: string
): Promise<{ body: Buffer; mimeType: string }> {
  const target = await resolveDownloadUrl(source, platformId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchExternal(target, {
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
  let filePath: string;
  if (s3Cache) {
    const key = s3ObjectKey(requestId);
    await s3Cache.client.send(
      new PutObjectCommand({
        Bucket: s3Cache.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      })
    );
    filePath = s3Path(key);
  } else {
    await mkdir(CACHE_DIR, { recursive: true });
    filePath = path.join(
      CACHE_DIR,
      `${createHash('sha256').update(requestId).digest('hex')}.audio`
    );
    const tempPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tempPath, body, { mode: 0o600 });
    await rename(tempPath, filePath);
  }
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
  const key = s3Key(row[0].filePath);
  if (key && s3Cache) {
    await s3Cache.client.send(new DeleteObjectCommand({ Bucket: s3Cache.bucket, Key: key }));
  } else {
    await rm(row[0].filePath, { force: true });
  }
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
