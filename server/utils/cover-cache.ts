import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { logError } from './logger';

const MAX_BYTES = 5 * 1024 * 1024;

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
  if (!s3Cache) return null;
  try {
    const response = await s3Cache.client.send(
      new GetObjectCommand({ Bucket: s3Cache.bucket, Key: objectKey(source, id, size) })
    );
    if (!response.Body) return null;
    return {
      body: await readBody(response.Body as AsyncIterable<Uint8Array>),
      contentType: response.ContentType ?? 'image/jpeg',
    };
  } catch {
    return null;
  }
}

export async function saveCachedCover(
  source: string,
  id: string,
  size: string,
  cover: CachedCover
): Promise<void> {
  if (!s3Cache) return;
  try {
    await s3Cache.client.send(
      new PutObjectCommand({
        Bucket: s3Cache.bucket,
        Key: objectKey(source, id, size),
        Body: cover.body,
        ContentType: cover.contentType,
        CacheControl: 'public, max-age=2592000',
      })
    );
  } catch (error) {
    logError('封面对象存储写入失败', error, { source, id, size });
  }
}
