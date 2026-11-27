import { defineEventHandler, setHeader } from 'h3';
import { SOURCES, SOURCE_LABELS } from '../utils/domain';
import type { SourceId } from '../utils/domain';
import { listMetingApis } from '../utils/music-sources';

/**
 * 当前实际可搜索的音源列表。
 *
 * 前端据此渲染音源 tab：只挂模板 provider 的平台才会出现，避免把没有
 * provider 的新平台显示成一个永远空白的标签页。
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=60, s-maxage=60');

  const apis = (await listMetingApis()).filter(
    (api) => api.enabled && api.capabilities.includes('search')
  );
  const available = new Set<SourceId>();
  for (const api of apis) {
    for (const platform of api.platforms) available.add(platform);
  }

  return {
    sources: SOURCES.filter((source) => available.has(source)).map((source) => ({
      id: source,
      label: SOURCE_LABELS[source],
    })),
  };
});
