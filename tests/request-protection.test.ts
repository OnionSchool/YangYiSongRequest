import { describe, expect, it } from 'vitest';
import { requestContextHash } from '../server/utils/request-protection';

describe('点歌挑战上下文', () => {
  const request = {
    source: 'netease',
    platformId: ' 123 ',
    title: ' 一首歌 ',
    artist: '歌手',
    album: undefined,
    durationMs: '120000',
    grade: 'G1',
    classNo: '2',
    requesterName: ' 小明 ',
  };

  it('对等价输入生成稳定摘要', () => {
    expect(requestContextHash(request)).toBe(
      requestContextHash({ ...request, platformId: '123', title: '一首歌', requesterName: '小明' })
    );
  });

  it('在提交内容变化时生成不同摘要', () => {
    expect(requestContextHash(request)).not.toBe(
      requestContextHash({ ...request, title: '另一首歌' })
    );
  });
});
