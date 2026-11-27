/**
 * 「模板音源」的纯逻辑内核：URL 模板渲染 + 响应字段映射。
 *
 * 这类音源（vkeys、oiapi、haitangw、nxinxz……）不执行任何脚本，只描述
 * 「用哪个 URL 查询」「响应里哪一段是歌曲列表」「每首歌的字段在哪」，
 * 因此可以安全地在 Nitro 进程里跑，全部请求仍走 external-url 的白名单。
 */

import { createHash } from 'node:crypto';

/** 模板占位符：`${keyword}` `${id}` `${page}` `${limit}` `${size}` */
export const TEMPLATE_VARS = ['keyword', 'id', 'page', 'limit', 'size'] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];

export interface TemplateVars {
  keyword?: string;
  id?: string;
  page?: number;
  limit?: number;
  size?: number | string;
}

/**
 * 计算 md5hex 表达式：变量占位符与字符串字面量用 + 拼接。
 * 用简单的引号感知扫描而不是 eval，表达式里不允许出现函数调用或运算符。
 */
function evaluateConcat(expr: string, vars: TemplateVars): string {
  let out = '';
  let buffer = '';
  let inString = false;
  let quote = '';
  const flushBuffer = () => {
    const trimmed = buffer.trim();
    buffer = '';
    if (!trimmed) return;
    const match = trimmed.match(/^\$\{(\w+)\}$/);
    if (!match) return;
    const value = vars[match[1] as TemplateVar];
    if (value !== undefined && value !== null) out += String(value);
  };
  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i] as string;
    if (inString) {
      if (char === quote) {
        inString = false;
        continue;
      }
      out += char;
      continue;
    }
    if (char === '"' || char === "'") {
      flushBuffer();
      inString = true;
      quote = char;
      continue;
    }
    if (char === '+') {
      flushBuffer();
      continue;
    }
    buffer += char;
  }
  flushBuffer();
  return out;
}

/**
 * 渲染模板。占位符缺失时保留原样，便于管理员在测试里立刻看出少填了什么。
 * 关键词同时提供 URL 编码形式（`${keyword}` 已编码，`${keywordRaw}` 原样）。
 *
 * 函数型占位符（先于普通变量展开）：
 *   `${md5hex(id + "salt")}`      —— 对拼接结果求 MD5 十六进制小写摘要；
 *   `${md5hexUpper(...)}`          —— 同上但大写。
 * 表达式里只接受变量占位符与单/双引号字符串字面量的 + 拼接，
 * 这不是脚本执行，只是字符串拼接，无法形成注入面。
 * 用途：酷狗等官方端点的静态签名（key = md5(hash + "kgcloudv2")）。
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const withHashes = template.replace(
    /\$\{(md5hex|md5hexUpper)\(([^()]*)\)\}/g,
    (match, fn: string, expr: string) => {
      const source = evaluateConcat(expr, vars);
      // 表达式里一个变量都没命中时保留原样，和变量占位符行为一致。
      if (!source && !/^[\s+]*(['"])/.test(expr.trim())) return match;
      const digest = createHash('md5').update(source).digest('hex');
      return fn === 'md5hexUpper' ? digest.toUpperCase() : digest;
    }
  );
  return withHashes.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    if (name === 'keywordRaw') return vars.keyword === undefined ? match : vars.keyword;
    const value = vars[name as TemplateVar];
    if (value === undefined || value === null || value === '') return match;
    // keyword 与 id 都可能含中文、空格或斜杠，放进 query 或路径前都要编码。
    if (name === 'keyword' || name === 'id') return encodeURIComponent(String(value));
    return String(value);
  });
}

/** 解析后的 JSON 值形状，用作模板映射函数的输入边界类型。 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 点号路径取值，支持 `a.b` 与 `a.0.b`。 */
export function readField(value: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

export type FieldPath = string | readonly string[];

export interface TemplateFieldMap {
  /** 歌曲数组所在路径；缺省时先按根数组尝试，再逐个内置候选路径。 */
  list?: FieldPath;
  id?: FieldPath;
  title?: FieldPath;
  artist?: FieldPath;
  album?: FieldPath;
  duration?: FieldPath;
  /** 搜索/详情里的封面地址（或封面 id）。 */
  cover?: FieldPath;
  /** 音频地址：既用于 `audioUrlTemplate` 返回 JSON，也用于搜索里直接给的直链。 */
  audio?: FieldPath;
}

const FIELD_CANDIDATES: Required<Omit<TemplateFieldMap, 'list'>> = {
  // 各家字段名差异极大：vkeys 用 id/song/singer、kuwo 用 DC_TARGETID/NAME/ARTIST、
  // oiapi 用 rid/song/singer，所以每个字段都给一组候选，命中第一个可用值。
  id: ['id', 'rid', 'musicrid', 'songmid', 'songId', 'nid', 'hash', 'DC_TARGETID', 'rid_str'],
  title: ['song', 'title', 'name', 'songname', 'NAME', 'SONGNAME'],
  artist: ['singer', 'artist', 'author', 'artists', 'singername', 'ARTIST', 'AARTIST'],
  album: ['album', 'albumname', 'albumName', 'ALBUM'],
  duration: ['time', 'duration', 'interval', 'duration_ms', 'DURATION', 'dt'],
  cover: ['picture', 'pic', 'cover', 'img', 'albumpic', 'ARTISTPIC'],
  audio: ['url', 'link', 'music', 'src', 'data.url', 'musicUrl'],
};

/** 列表所在的候选路径，覆盖根数组之外的常见包装。 */
const LIST_CANDIDATES = [
  'data',
  'list',
  'songs',
  'abslist',
  'result',
  'data.data',
  'data.list',
  'data.songs',
  'data.result',
  'data.abslist',
] as const;

function candidatePaths(
  value: FieldPath | undefined,
  name: keyof typeof FIELD_CANDIDATES
): string[] {
  if (value === undefined) return [...FIELD_CANDIDATES[name]];
  return typeof value === 'string' ? [value] : [...value];
}

/** 按字段映射取第一个有值的结果。 */
export function pickField(
  record: JsonValue,
  path: FieldPath | undefined,
  name: keyof typeof FIELD_CANDIDATES
): JsonValue | undefined {
  for (const candidate of candidatePaths(path, name)) {
    const value = readField(record, candidate);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** 把响应体归一成「歌曲对象数组」。单对象响应（如 oiapi）会被包成一项。 */
export function extractSongRecords(data: JsonValue, map: TemplateFieldMap): JsonValue[] {
  const candidates = map.list === undefined ? [...LIST_CANDIDATES] : candidatePaths(map.list, 'id');
  // 先把所有候选路径都看一遍找数组：`data` 常常是一个包装对象，
  // 真正的列表在 `data.data`，过早把对象当单条记录会丢掉整个列表。
  for (const path of candidates) {
    const value = readField(data, path);
    if (Array.isArray(value)) return value;
  }
  if (Array.isArray(data)) return data;
  // 没有数组时，才把对象当作「单条记录」（oiapi 这类接口的返回形状）。
  for (const path of candidates) {
    const value = readField(data, path);
    if (value && typeof value === 'object') return [value];
  }
  if (data && typeof data === 'object') {
    // 最后兜底：对象里唯一一个数组字段很可能就是列表。
    const arrays = Object.values(data).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as JsonValue[];
  }
  return [];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** 接口返回的歌手名常带 HTML 实体（酷我 `ARTIST` 里就有 `&nbsp;`）。 */
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:nbsp|amp|lt|gt|quot|#39);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity
  );
}

export function normalizeArtist(value: unknown): string {
  if (Array.isArray(value)) {
    const names = value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        const name = item && typeof item === 'object' ? pickField(item, undefined, 'title') : '';
        return stringValue(name) ?? '';
      })
      .filter(Boolean);
    if (names.length > 0) return names.join(' / ');
  }
  return stringValue(decodeEntities(stringValue(value) ?? '') ?? '') ?? '';
}

/** 时间统一换算成毫秒；纯数字小于 10000 视为秒。 */
export function normalizeDurationMs(value: unknown): number {
  const text = stringValue(value);
  if (!text) return 0;
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) {
    const hours = Number(clock[1] ?? 0);
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [minutes, seconds] = text.split(':').map(Number);
    return (minutes! * 60 + seconds!) * 1000;
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric < 10_000 ? numeric * 1000 : numeric);
}

export function normalizePlatformId(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  // 酷我的 rid 形如 MUSIC_228908，作为路径参数时保留原样即可。
  return text;
}

export interface MappedSong {
  platformId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  cover?: string;
  audio?: string;
}

/** 把一条原始记录映射成统一歌曲结构；缺 id 时返回 null（该条无法点歌）。 */
export function mapSongRecord(record: JsonValue, map: TemplateFieldMap): MappedSong | null {
  const platformId = normalizePlatformId(pickField(record, map.id, 'id'));
  if (!platformId) return null;
  return {
    platformId,
    title: decodeEntities(stringValue(pickField(record, map.title, 'title')) ?? ''),
    artist: normalizeArtist(pickField(record, map.artist, 'artist')),
    album: decodeEntities(stringValue(pickField(record, map.album, 'album')) ?? ''),
    durationMs: normalizeDurationMs(pickField(record, map.duration, 'duration')),
    cover: stringValue(pickField(record, map.cover, 'cover')),
    audio: stringValue(pickField(record, map.audio, 'audio')),
  };
}

/** 解析管理员填写的字段映射 JSON；非法内容回退成空映射（走内置候选）。 */
export function parseFieldMap(raw: string | null | undefined): TemplateFieldMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: TemplateFieldMap = {};
    for (const key of [
      'list',
      'id',
      'title',
      'artist',
      'album',
      'duration',
      'cover',
      'audio',
    ] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) map[key] = value.trim();
      else if (Array.isArray(value)) {
        const paths = value.filter(
          (item): item is string => typeof item === 'string' && !!item.trim()
        );
        if (paths.length > 0) map[key] = paths;
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** 提取音频直链时的默认字段候选，覆盖 lx 生态常见返回形状。 */
export const AUDIO_URL_FALLBACK_PATHS = ['url', 'data.url', 'data', 'music', 'link'] as const;

/**
 * 音频端点返回 JSON 时，按什么顺序尝试哪些字段路径。
 * 管理员在 fieldMap 里显式配置的 audio 路径优先，内置候选兜底。
 */
export function audioUrlPaths(map: TemplateFieldMap): readonly string[] {
  if (map.audio === undefined) return AUDIO_URL_FALLBACK_PATHS;
  if (typeof map.audio === 'string') return [map.audio, ...AUDIO_URL_FALLBACK_PATHS];
  return [...map.audio, ...AUDIO_URL_FALLBACK_PATHS];
}
