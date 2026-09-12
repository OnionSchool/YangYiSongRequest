import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import { saveDownloadTemplates } from '../../../utils/download-config';
import { writeAudit } from '../../../utils/audit';
import { badRequest } from '../../../utils/errors';
import type { SourceId } from '../../../utils/domain';

const SOURCES: readonly SourceId[] = ['netease', 'qq', 'kugou'];

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody<{ templates?: unknown }>(event);
  if (!body.templates || typeof body.templates !== 'object' || Array.isArray(body.templates)) {
    throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址配置无效');
  }
  const input = body.templates as Record<string, unknown>;
  const templates = Object.fromEntries(
    SOURCES.map((source) => {
      const value = input[source];
      if (typeof value !== 'string' || value.length > 2_000) {
        throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址配置无效');
      }
      return [source, value];
    })
  ) as Record<SourceId, string>;
  await saveDownloadTemplates(templates);
  await writeAudit(session.userId, 'config.downloads', null, {
    configured: SOURCES.filter((source) => Boolean(templates[source].trim())),
  });
  return { templates };
});
