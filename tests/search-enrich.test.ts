import { describe, expect, it } from 'vitest';
import { enrichTemplateMetadata } from '../server/utils/music-sources';
import type { SearchPage } from '../server/utils/music-sources';

function page(songs: SearchPage['songs']): SearchPage {
  return { source: 'qq', keyword: '晴天', page: 1, pageSize: 20, total: songs.length, songs };
}

describe('enrichTemplateMetadata 模板富化', () => {
  const baseSong = {
    source: 'qq' as const,
    platformId: '0039MnYb0qxYhV',
    title: '晴天',
    artist: '周杰伦',
    album: undefined,
    durationMs: 0,
    coverUrl: undefined,
    vip: false,
  };

  it('按 platformId 补齐缺失的时长和专辑', () => {
    const primary = page([{ ...baseSong }]);
    const template = page([{ ...baseSong, durationMs: 269000, album: '叶惠美' }]);
    const out = enrichTemplateMetadata(primary, template);
    expect(out.songs[0]?.durationMs).toBe(269000);
    expect(out.songs[0]?.album).toBe('叶惠美');
  });

  it('不覆盖 meting 已有的值', () => {
    const primary = page([{ ...baseSong, durationMs: 100000 }]);
    const template = page([{ ...baseSong, durationMs: 269000 }]);
    expect(enrichTemplateMetadata(primary, template).songs[0]?.durationMs).toBe(100000);
  });

  it('id 不匹配的条目原样保留', () => {
    const primary = page([{ ...baseSong, platformId: 'OTHER' }]);
    const template = page([{ ...baseSong, durationMs: 269000 }]);
    expect(enrichTemplateMetadata(primary, template).songs[0]?.durationMs).toBe(0);
  });

  it('没有任何富化发生时原样返回（引用相等）', () => {
    const primary = page([{ ...baseSong, platformId: 'NOMATCH' }]);
    const template = page([{ ...baseSong }]);
    expect(enrichTemplateMetadata(primary, template)).toBe(primary);
  });
});
