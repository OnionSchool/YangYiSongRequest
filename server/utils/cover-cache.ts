import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { logError } from './logger';
import { reserveObjectStorageRead, reserveObjectStorageWrite } from './object-storage-budget';

const MAX_BYTES = 5 * 1024 * 1024;
const MEMORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MEMORY_CACHE_LIMIT = 500;
const MEMORY_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;

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
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

const s3Cache = getS3CacheConfig();

function objectKey(source: string, id: string, size: string): string {
  const hash = createHash('sha256').update(`${source}\u0000${id}\u0000${size}`).digest('hex');
  return `cover-cache/${hash}.image`;
}

function cacheKey(source: string, id: string, size: string): string {
  return `${source}\u0000${id}\u0000${size}`;
}

interface MemoryEntry {
  cover: CachedCover;
  expiresAt: number;
  sizeBytes: number;
}

const memoryCache = new Map<string, MemoryEntry>();
let memoryCacheBytes = 0;
const negativeCache = new Map<string, number>();
const readInFlight = new Map<string, Promise<CachedCover | null>>();
const writeInFlight = new Map<string, Promise<void>>();

function readMemoryCache(key: string): CachedCover | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    memoryCacheBytes -= entry.sizeBytes;
    return null;
  }
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.cover;
}

function writeMemoryCache(key: string, cover: CachedCover): void {
  const existing = memoryCache.get(key);
  if (existing) memoryCacheBytes -= existing.sizeBytes;
  memoryCache.delete(key);
  const entry = {
    cover,
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
    sizeBytes: cover.body.length,
  };
  memoryCache.set(key, entry);
  memoryCacheBytes += entry.sizeBytes;
  while (memoryCache.size > MEMORY_CACHE_LIMIT || memoryCacheBytes > MEMORY_CACHE_MAX_BYTES) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = memoryCache.get(oldestKey);
    memoryCache.delete(oldestKey);
    if (oldest) memoryCacheBytes -= oldest.sizeBytes;
  }
}

function markMissing(key: string): void {
  negativeCache.set(key, Date.now() + NEGATIVE_CACHE_TTL_MS);
  if (negativeCache.size > MEMORY_CACHE_LIMIT) negativeCache.clear();
}

function isNegativeCached(key: string): boolean {
  const expiresAt = negativeCache.get(key);
  if (!expiresAt) return false;
  if (expiresAt > Date.now()) return true;
  negativeCache.delete(key);
  return false;
}

function isMissingObject(error: unknown): boolean {
  const details = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    details.name === 'NoSuchKey' ||
    details.name === 'NotFound' ||
    details.$metadata?.httpStatusCode === 404
  );
}

async function readBody(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error('封面图片超过大小限制');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export interface CachedCover {
  body: Buffer;
  contentType: string;
}

export async function readCachedCover(
  source: string,
  id: string,
  size: string
): Promise<CachedCover | null> {
  const key = cacheKey(source, id, size);
  const memoryHit = readMemoryCache(key);
  if (memoryHit || isNegativeCached(key) || !s3Cache) return memoryHit;

  const existing = readInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      if (!reserveObjectStorageRead()) return null;
      const response = await s3Cache.client.send(
        new GetObjectCommand({ Bucket: s3Cache.bucket, Key: objectKey(source, id, size) })
      );
      if (!response.Body) {
        markMissing(key);
        return null;
      }
      const cover = {
        body: await readBody(response.Body as AsyncIterable<Uint8Array>),
        contentType: response.ContentType ?? 'image/jpeg',
      };
      writeMemoryCache(key, cover);
      return cover;
    } catch (error) {
      if (isMissingObject(error)) markMissing(key);
      return null;
    } finally {
      readInFlight.delete(key);
    }
  })();

  readInFlight.set(key, request);
  return request;
}

export async function saveCachedCover(
  source: string,
  id: string,
  size: string,
  cover: CachedCover
): Promise<void> {
  if (!s3Cache) return;
  const key = cacheKey(source, id, size);
  if (readMemoryCache(key)) return;

  const existing = writeInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    negativeCache.delete(key);
    writeMemoryCache(key, cover);
    try {
      const storageKey = objectKey(source, id, size);
      if (!reserveObjectStorageWrite(storageKey, cover.body.length)) return;
      await s3Cache.client.send(
        new PutObjectCommand({
          Bucket: s3Cache.bucket,
          Key: storageKey,
          Body: cover.body,
          ContentType: cover.contentType,
          CacheControl: 'public, max-age=2592000, immutable',
        })
      );
    } catch (error) {
      logError('封面对象存储写入失败', error, { source, id, size });
    } finally {
      writeInFlight.delete(key);
    }
  })();

  writeInFlight.set(key, request);
  return request;
}
