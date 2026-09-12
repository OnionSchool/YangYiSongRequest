import { defineEventHandler, setHeader } from 'h3';
import { requirePlanner } from '../../../utils/admin-auth';
import { searchSongs, SourceError } from '../../../utils/music-sources';
import type { SourceId } from '../../../utils/domain';

const SOURCES: Array<{ source: SourceId; label: string }> = [
  { source: 'netease', label: '网易云音乐' },
  { source: 'qq', label: 'QQ 音乐' },
  { source: 'kugou', label: '酷狗音乐' },
];

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  requirePlanner(event);

  const metingUrl = process.env.METING_API_URL;

  const results = await Promise.all(
    SOURCES.map(async ({ source, label }) => {
      if (!metingUrl) {
        return { source, label, ok: false, detail: '未配置 METING_API_URL' };
      }
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

  return results;
});
