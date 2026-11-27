import { describe, expect, it } from 'vitest';
import {
  extractSongRecords,
  mapSongRecord,
  normalizeArtist,
  normalizeDurationMs,
  normalizePlatformId,
  parseFieldMap,
  pickField,
  readField,
  renderTemplate,
} from '../server/utils/music-templates';

describe('renderTemplate', () => {
  it('替换已编码关键词、页码与每页条数', () => {
    expect(
      renderTemplate('https://api.test/s?w=${keyword}&page=${page}&n=${limit}', {
        keyword: '晴天',
        page: 2,
        limit: 10,
      })
    ).toBe(`https://api.test/s?w=${encodeURIComponent('晴天')}&page=2&n=10`);
  });

  it('keywordRaw 不做 URL 编码，供 query 之外的场景使用', () => {
    expect(renderTemplate('https://api.test/${keywordRaw}', { keyword: 'a b' })).toBe(
      'https://api.test/a b'
    );
  });

  it('id 占位符用平台歌曲 ID 填充并编码', () => {
    expect(renderTemplate('https://api.test/u?id=${id}', { id: '1 2' })).toBe(
      'https://api.test/u?id=1%202'
    );
  });

  it('未提供的占位符保留原样，便于管理员看出漏填', () => {
    expect(renderTemplate('https://api.test/?p=${page}', {})).toBe('https://api.test/?p=${page}');
  });

  it('未知占位符原样保留，避免静默丢掉模板语义', () => {
    expect(renderTemplate('https://api.test/?x=${unknown}', {})).toBe(
      'https://api.test/?x=${unknown}'
    );
  });
});

describe('readField / pickField', () => {
  it('支持点号路径读取嵌套字段', () => {
    expect(readField({ a: { b: '深' } }, 'a.b')).toBe('深');
  });

  it('路径中断时返回 undefined 而不是抛错', () => {
    expect(readField({ a: null }, 'a.b')).toBeUndefined();
    expect(readField(null, 'a.b')).toBeUndefined();
  });

  it('优先使用显式映射的字段', () => {
    expect(pickField({ rid: '7', id: '9' }, 'rid', 'id')).toBe('7');
  });

  it('显式映射缺失时回退到内置候选名', () => {
    expect(pickField({ rid: '7' }, undefined, 'id', 'rid')).toBe('7');
  });
});

describe('extractSongRecords', () => {
  it('识别常见的列表容器路径', () => {
    expect(extractSongRecords({ data: [{ id: '1' }] }, {})).toEqual([{ id: '1' }]);
    expect(extractSongRecords({ abslist: [{ id: '2' }] }, {})).toEqual([{ id: '2' }]);
    expect(extractSongRecords({ data: { data: [{ id: '3' }] } }, {})).toEqual([{ id: '3' }]);
  });

  it('顶层就是数组时直接使用', () => {
    expect(extractSongRecords([{ id: '1' }], {})).toEqual([{ id: '1' }]);
  });

  it('返回单对象接口时包成一条记录', () => {
    expect(extractSongRecords({ data: { song: '单曲' } }, {})).toEqual([{ song: '单曲' }]);
  });

  it('认不出形状时返回空数组', () => {
    expect(extractSongRecords({ data: 'oops' }, {})).toEqual([]);
    expect(extractSongRecords(null, {})).toEqual([]);
  });

  it('支持用 fieldMap.list 指定列表路径', () => {
    expect(
      extractSongRecords({ result: { items: [{ id: '1' }] } }, { list: 'result.items' })
    ).toEqual([{ id: '1' }]);
  });
});

describe('mapSongRecord', () => {
  it('映射标准字段并归一化时长', () => {
    const mapped = mapSongRecord(
      { id: '42', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: '269000' },
      {}
    );
    expect(mapped).toMatchObject({
      platformId: '42',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      durationMs: 269000,
    });
  });

  it('标题与专辑里的 HTML 实体也会解码（酷我真实响应）', () => {
    const mapped = mapSongRecord(
      { DC_TARGETID: '51685512', NAME: '晴天&nbsp;(KTV版伴奏)', ALBUM: '叶惠美&amp;' },
      {}
    );
    expect(mapped?.title).toBe('晴天 (KTV版伴奏)');
    expect(mapped?.album).toBe('叶惠美&');
  });

  it('缺 ID 时返回 null，避免产出无法点歌的条目', () => {
    expect(mapSongRecord({ title: '无 ID' }, {})).toBeNull();
  });

  it('遵循自定义字段映射', () => {
    const map = parseFieldMap('{"id":"rid","title":"song","artist":"singer"}');
    expect(mapSongRecord({ rid: 88, song: '自定义', singer: '某歌手' }, map)).toMatchObject({
      platformId: '88',
      title: '自定义',
      artist: '某歌手',
    });
  });
});

describe('normalizeArtist', () => {
  it('把 HTML 实体与多余空白清掉', () => {
    expect(normalizeArtist('周杰伦&nbsp;/ 方文山')).toBe('周杰伦 / 方文山');
  });

  it('数组歌手用斜杠连接', () => {
    expect(normalizeArtist(['周杰伦', '费玉清'])).toBe('周杰伦 / 费玉清');
  });

  it('空值返回空字符串', () => {
    expect(normalizeArtist(null)).toBe('');
    expect(normalizeArtist(undefined)).toBe('');
  });
});

describe('normalizeDurationMs', () => {
  it('秒级数字折算成毫秒', () => {
    expect(normalizeDurationMs(269)).toBe(269000);
  });

  it('已经是毫秒的量级保持不变', () => {
    expect(normalizeDurationMs(269000)).toBe(269000);
  });

  it('mm:ss 字符串能解析', () => {
    expect(normalizeDurationMs('04:29')).toBe(269000);
  });

  it('无法解析时返回 0', () => {
    expect(normalizeDurationMs('--')).toBe(0);
    expect(normalizeDurationMs(null)).toBe(0);
  });
});

describe('normalizePlatformId', () => {
  it('数字转字符串', () => {
    expect(normalizePlatformId(123)).toBe('123');
  });

  it('去掉首尾空白', () => {
    expect(normalizePlatformId('  456  ')).toBe('456');
  });

  it('空值返回 undefined，由调用方判断为无效记录', () => {
    expect(normalizePlatformId(undefined)).toBeUndefined();
    expect(normalizePlatformId('   ')).toBeUndefined();
  });
});

describe('parseFieldMap', () => {
  it('解析合法 JSON 对象', () => {
    expect(parseFieldMap('{"id":"rid"}')).toEqual({ id: 'rid' });
  });

  it('非法 JSON 回退成空映射，交给内置候选兜底', () => {
    expect(parseFieldMap('{bad json')).toEqual({});
    expect(parseFieldMap('')).toEqual({});
    expect(parseFieldMap(null)).toEqual({});
  });

  it('数组不是合法映射', () => {
    expect(parseFieldMap('[1,2]')).toEqual({});
  });
});
