import { defineEventHandler, setHeader } from 'h3';
import { requirePlanner } from '../../../utils/admin-auth';
import { listMetingApis, searchSongs, SourceError } from '../../../utils/music-sources';
import { SOURCES, SOURCE_LABELS } from '../../../utils/domain';
import type { SourceId } from '../../../utils/domain';

/** 只检测配置里真的挂了 provider 的平台，避免把未启用的平台报成故障。 */
async function configuredSources(): Promise<SourceId[]> {
  const apis = (await listMetingApis()).filter((api) => api.enabled);
  const platforms = new Set<SourceId>();
  for (const api of apis) {
    if (!api.capabilities.includes('search')) continue;
    for (const platform of api.platforms) platforms.add(platform);
  }
  return SOURCES.filter((source) => platforms.has(source));
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requirePlanner(event);

  const sources = await configuredSources();
  if (sources.length === 0) return [];

  return await Promise.all(
    sources.map(async (source) => {
      const label = SOURCE_LABELS[source];
      try {
        const result = await searchSongs(source, '测试', 1);
        return {
          source,
          label,
          ok: true,
          detail: `搜索可用（测试返回 ${result.total} 条）`,
        };
      } catch (error) {
        const message = error instanceof SourceError ? error.message : '搜索测试失败';
        return { source, label, ok: false, detail: message };
      }
    })
  );
});
