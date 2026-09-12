import { eq } from 'drizzle-orm';
import type { SourceId } from './domain';
import { db } from './db';
import { badRequest } from './errors';
import { siteSetting } from './schema';

const SOURCES: readonly SourceId[] = ['netease', 'qq', 'kugou'];
const SETTING_PREFIX = 'downloadUrl.';

function trustedHosts(): Set<string> {
  return new Set(
    (process.env.MUSIC_DOWNLOAD_TRUSTED_HOSTS ?? '')
      .split(',')
      .map((host: string) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function validateDownloadTemplate(value: string): string {
  const template = value.trim();
  if (!template) return '';
  if (!template.includes('{id}')) {
    throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址必须包含 {id} 占位符');
  }
  let target: URL;
  try {
    target = new URL(template.replaceAll('{id}', 'song-id'));
  } catch {
    throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址格式无效');
  }
  if (target.protocol !== 'https:') {
    throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址必须使用 HTTPS');
  }
  const hosts = trustedHosts();
  if (!hosts.has(target.hostname.toLowerCase())) {
    throw badRequest('DOWNLOAD_TEMPLATE_UNTRUSTED', '下载地址主机不在部署者配置的可信范围内');
  }
  return template;
}

export async function readDownloadTemplates(): Promise<Record<SourceId, string>> {
  const rows = await db.select().from(siteSetting);
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(
    SOURCES.map((source) => [source, settings.get(`${SETTING_PREFIX}${source}`) ?? ''])
  ) as Record<SourceId, string>;
}

export async function saveDownloadTemplates(templates: Record<SourceId, string>): Promise<void> {
  for (const source of SOURCES) {
    const key = `${SETTING_PREFIX}${source}`;
    const value = validateDownloadTemplate(templates[source] ?? '');
    const existing = await db.select().from(siteSetting).where(eq(siteSetting.key, key)).limit(1);
    if (existing.length) {
      await db.update(siteSetting).set({ value }).where(eq(siteSetting.key, key));
    } else {
      await db.insert(siteSetting).values({ key, value });
    }
  }
}
