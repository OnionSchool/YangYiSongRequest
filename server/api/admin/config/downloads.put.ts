import { defineEventHandler, readBody, setHeader } from 'h3';
import { requireSuper } from '../../../utils/admin-auth';
import {
  saveDownloadMode,
  saveDownloadTemplates,
  type DownloadMode,
} from '../../../utils/download-config';
import { writeAudit } from '../../../utils/audit';
import { badRequest } from '../../../utils/errors';
import type { SourceId } from '../../../utils/domain';
import { validateExternalUrl } from '../../../utils/external-url';

const SOURCES: readonly SourceId[] = ['netease', 'qq', 'kugou'];

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const session = requireSuper(event);
  const body = await readBody<{ templates?: unknown; mode?: unknown }>(event);
  if (!body.templates || typeof body.templates !== 'object' || Array.isArray(body.templates)) {
    throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址配置无效');
  }
  const input = body.templates as Record<string, unknown>;
  if (body.mode !== 'direct' && body.mode !== 'proxy') {
    throw badRequest('DOWNLOAD_MODE_INVALID', '下载模式无效');
  }
  const templates = Object.fromEntries(
    await Promise.all(
      SOURCES.map(async (source) => {
        const value = input[source];
        if (typeof value !== 'string' || value.length > 2_000) {
          throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址配置无效');
        }
        if (value && value.split('{id}').length !== 2) {
          throw badRequest('DOWNLOAD_TEMPLATE_INVALID', '下载地址必须且只能包含一个 {id}');
        }
        if (value) await validateExternalUrl(value.replace('{id}', 'test'));
        return [source, value];
      })
    )
  ) as Record<SourceId, string>;
  const mode = body.mode as DownloadMode;
  await Promise.all([saveDownloadTemplates(templates), saveDownloadMode(mode)]);
  await writeAudit(session.userId, 'config.downloads', null, {
    mode,
    configured: SOURCES.filter((source) => Boolean(templates[source].trim())),
  });
  return { templates, mode };
});
