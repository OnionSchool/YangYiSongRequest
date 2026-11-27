import { describe, expect, it } from 'vitest';
import {
  analyzeLxScript,
  extractLxTemplates,
  guessLxPlatforms,
  inferFieldMapFromJson,
  isObfuscatedScript,
} from '../server/utils/lx-parse';
import type { JsonValue } from '../server/utils/music-templates';

// 仿 huanyin.js 的最小样本：encodeURIComponent(keyword) 链与 qualityMap 码率。
const HUANYIN_LIKE = `
const {EVENT_NAMES, request, on, send, utils, env, version} = globalThis.lx;
async function searchMigu(keyword, page) {
  const encoded = encodeURIComponent(keyword)
  const url = \`https://api.example.com/api/music/migu?gm=\${encoded}&n=\${page}&num=1&type=json\`
  return url
}
async function getMusicUrl(source, info) {
  const platformMap = { 'tx': 'qq', 'kw': 'kuwo', 'wy': 'netease' }
  const platform = platformMap[source]
  const songId = info.musicInfo.songmid
  const br = qualityMap[quality] || '320k'
  return \`https://dl.example.com/api/?source=\${platform}&id=\${songId}&type=url&br=\${br}\`
}
if (action === 'search' && source === 'mg') {}
`;

// 仿酷我搜索接口的真实响应形状（单引号伪 JSON 已由 parseLooseJson 处理，这里给解析后的结构）。
const KUWO_LIKE_RESPONSE = {
  abslist: [
    {
      DC_TARGETID: '51685512',
      NAME: '晴天',
      AARTIST: '周杰伦',
      ALBUM: '叶惠美',
      DURATION: '269',
    },
    {
      DC_TARGETID: '228908',
      NAME: '稻香',
      AARTIST: '周杰伦',
      ALBUM: '魔杰座',
      DURATION: '223',
    },
  ],
} as unknown as JsonValue;

const OIAPI_LIKE_RESPONSE = {
  code: 1,
  data: {
    rid: '228908',
    song: '稻香',
    singer: '周杰伦',
    album: '魔杰座',
    duration: '03:43',
    cover: 'https://img.example.com/cover.jpg',
    url: 'https://audio.example.com/228908.mp3',
  },
} as unknown as JsonValue;

describe('analyzeLxScript', () => {
  it('提取搜索模板并把 encoded 解析回 ${keyword}', () => {
    const result = analyzeLxScript(HUANYIN_LIKE);
    const search = result.candidates.find(
      (candidate) => candidate.kind === 'search' && candidate.template.includes('api.example.com')
    );
    expect(search).toBeTruthy();
    expect(search!.template).toBe(
      'https://api.example.com/api/music/migu?gm=${keyword}&n=${page}&num=1&type=json'
    );
    expect(search!.unresolved).toHaveLength(0);
  });

  it('音频模板里无法解析的 platform 保留为未解析项', () => {
    const result = analyzeLxScript(HUANYIN_LIKE);
    const audio = result.candidates.find((candidate) => candidate.kind === 'audio');
    expect(audio).toBeTruthy();
    expect(audio!.template).toContain('id=${id}');
    expect(audio!.template).toContain('br=320k');
    expect(audio!.unresolved).toContain('platform');
  });

  it('从 platformMap 猜测平台', () => {
    const platforms = guessLxPlatforms(HUANYIN_LIKE);
    expect(platforms).toEqual(expect.arrayContaining(['migu', 'qq', 'kuwo', 'netease']));
  });

  it('混淆脚本识别后不再尝试提取', () => {
    const obfuscated = `(function(p,O){const d={p:0xfe,O:'\\x30\\x78\\x31\\x30\\x65'},v=Z;${'\\x41'.repeat(200)}})()`;
    expect(isObfuscatedScript(obfuscated)).toBe(true);
    const result = analyzeLxScript(obfuscated);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes('混淆'))).toBe(true);
  });

  it('没有 URL 的脚本如实报告', () => {
    const result = analyzeLxScript('const a = 1; on(EVENT_NAMES.search, () => null);');
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes('未在脚本中找到'))).toBe(true);
  });

  it('提取 @name 注释', () => {
    expect(analyzeLxScript('/**\n * @name 测试音源\n */\n' + HUANYIN_LIKE).scriptName).toBe(
      '测试音源'
    );
  });

  it('普通字符串 URL 也能提取', () => {
    const candidates = extractLxTemplates('const API = "https://api.example.com/v2/search";');
    expect(candidates.some((c) => c.template === 'https://api.example.com/v2/search')).toBe(true);
  });
});

describe('inferFieldMapFromJson', () => {
  it('kuwo 形状：识别 abslist 列表路径与大写字段名', () => {
    const inference = inferFieldMapFromJson(KUWO_LIKE_RESPONSE);
    expect(inference).not.toBeNull();
    expect(inference!.fieldMap.list).toBe('abslist');
    expect(inference!.fieldMap.id).toBe('DC_TARGETID');
    expect(inference!.fieldMap.title).toBe('NAME');
    expect(inference!.fieldMap.artist).toBe('AARTIST');
    expect(inference!.songCount).toBe(2);
  });

  it('oiapi 形状：单对象响应被识别并标注', () => {
    const inference = inferFieldMapFromJson(OIAPI_LIKE_RESPONSE);
    expect(inference).not.toBeNull();
    expect(inference!.singleObject).toBe(true);
    expect(inference!.fieldMap.title).toBe('song');
    expect(inference!.fieldMap.audio).toBe('url');
    expect(inference!.notes.some((note) => note.includes('直链'))).toBe(true);
  });

  it('无关结构返回 null', () => {
    expect(inferFieldMapFromJson({ code: 0, message: 'ok' } as unknown as JsonValue)).toBeNull();
  });

  it('嵌套列表 data.data 能被找到', () => {
    const nested = {
      data: {
        data: [
          { id: '1', title: '歌', singer: '人' },
          { id: '2', title: '曲', singer: '手' },
        ],
      },
    } as unknown as JsonValue;
    const inference = inferFieldMapFromJson(nested);
    expect(inference).not.toBeNull();
    expect(inference!.fieldMap.list).toBe('data.data');
  });
});
